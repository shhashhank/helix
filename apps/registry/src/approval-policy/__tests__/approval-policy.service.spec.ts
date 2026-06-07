import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApprovalPolicy } from '@prisma/client';
import { ApprovalPolicyRepository } from '../approval-policy.repository';
import { ApprovalPolicyService } from '../approval-policy.service';

const fakeRow = (overrides: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  id: 'row-id',
  orgId: null,
  policyId: 'default',
  version: 1,
  document: { id: 'default', version: 1, rules: [] } as object,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  ...overrides,
});

const validDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'default',
  version: 1,
  rules: [{ id: 'r1', when: { actions: ['deploy'] }, require: { approverRoles: ['lead'] } }],
  ...overrides,
});

describe('ApprovalPolicyService', () => {
  let repo: jest.Mocked<ApprovalPolicyRepository>;
  let service: ApprovalPolicyService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findLatestVersion: jest.fn(),
      findMaxVersion: jest.fn(),
      findAll: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<ApprovalPolicyRepository>;
    service = new ApprovalPolicyService(repo);
  });

  describe('create', () => {
    it('validates, opens version 1, and normalizes the stored document version', async () => {
      repo.findMaxVersion.mockResolvedValue(null);
      repo.create.mockResolvedValue(fakeRow());

      await service.create({ orgId: null, document: validDoc({ version: 9 }) });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: null,
          policyId: 'default',
          version: 1,
          document: expect.objectContaining({ id: 'default', version: 1 }), // 9 normalized to 1
        }),
      );
    });

    it('rejects a duplicate policy id with 409', async () => {
      repo.findMaxVersion.mockResolvedValue(1);
      await expect(service.create({ orgId: null, document: validDoc() })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid document with 400 (and never touches the repo)', async () => {
      const bad = { id: 'p', version: 1, rules: [{ id: 'r', when: {}, require: { approverRoles: [] } }] };
      await expect(service.create({ orgId: null, document: bad })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.findMaxVersion).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('appends the next version for the same policy id', async () => {
      repo.findById.mockResolvedValue(fakeRow({ policyId: 'default' }));
      repo.findMaxVersion.mockResolvedValue(2);
      repo.create.mockResolvedValue(fakeRow({ version: 3 }));

      const row = await service.update({ id: 'row-id', document: validDoc() });

      expect(row.version).toBe(3);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ version: 3, policyId: 'default' }));
    });

    it('404s when the target row is missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update({ id: 'missing', document: validDoc() })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s on a policy-id mismatch', async () => {
      repo.findById.mockResolvedValue(fakeRow({ policyId: 'other' }));
      await expect(service.update({ id: 'row-id', document: validDoc() })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('reads', () => {
    it('findById 404s when absent', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('findLatest 404s when no active policy', async () => {
      repo.findLatestVersion.mockResolvedValue(null);
      await expect(service.findLatest(null, 'default')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
