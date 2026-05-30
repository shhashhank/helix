import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgentDefinition } from '@prisma/client';
import {
  AgentDefinitionValidator,
  AgentDefinitionValidationError,
} from '../../validators/agent-definition.validator';
import { AgentDefinitionRepository } from '../agent-definition.repository';
import { AgentDefinitionService } from '../agent-definition.service';
import type { AgentDefinitionPayload } from '../dto/agent-definition.types';

// Minimal valid payload — sticks to required fields per the HELIX-50 schema.
const validPayload = (overrides: Partial<AgentDefinitionPayload> = {}): AgentDefinitionPayload => ({
  schemaVersion: '1.0.0',
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Planning Agent',
  role: 'planning',
  version: '1.0.0',
  systemPrompt: { template: 'You are a planner.' },
  modelPolicy: { tier: 'opus' },
  tools: [],
  guardrails: {},
  ...overrides,
});

const fakeRow = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  id: 'row-id',
  orgId: null,
  role: 'planning',
  version: 1,
  name: 'Planning Agent',
  description: null,
  systemPrompt: { template: 'p' } as object,
  modelPolicy: { tier: 'opus' } as object,
  tools: [] as object,
  guardrails: {} as object,
  outputSchema: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

describe('AgentDefinitionService', () => {
  let repo: jest.Mocked<AgentDefinitionRepository>;
  let validator: AgentDefinitionValidator;
  let service: AgentDefinitionService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findLatestVersion: jest.fn(),
      findMaxVersion: jest.fn(),
      findAll: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<AgentDefinitionRepository>;
    validator = new AgentDefinitionValidator(); // real validator — small, fast
    service = new AgentDefinitionService(repo, validator);
  });

  describe('create', () => {
    it('persists version=1 when no existing definition for the role', async () => {
      repo.findMaxVersion.mockResolvedValue(null);
      repo.create.mockResolvedValue(fakeRow());

      const result = await service.create({ orgId: null, payload: validPayload() });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ version: 1, role: 'planning' }));
      expect(result.version).toBe(1);
    });

    it('rejects when role already exists for the org', async () => {
      repo.findMaxVersion.mockResolvedValue(1);

      await expect(service.create({ orgId: null, payload: validPayload() })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('throws ValidationError on schema-invalid input', async () => {
      const bad = { ...validPayload(), role: 'not-a-role' } as unknown as AgentDefinitionPayload;
      await expect(service.create({ orgId: null, payload: bad })).rejects.toBeInstanceOf(
        AgentDefinitionValidationError,
      );
      expect(repo.findMaxVersion).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('inserts a new row with version = max+1, preserving older versions', async () => {
      repo.findById.mockResolvedValue(fakeRow({ id: 'cur', role: 'planning', orgId: null }));
      repo.findMaxVersion.mockResolvedValue(2);
      repo.create.mockImplementation(async (data) =>
        fakeRow({ ...(data as object), id: 'new-row' } as Partial<AgentDefinition>),
      );

      const result = await service.update({ id: 'cur', payload: validPayload() });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
      expect(result.id).toBe('new-row');
    });

    it('rejects when role is changed between update and current row', async () => {
      repo.findById.mockResolvedValue(fakeRow({ role: 'planning' }));
      repo.findMaxVersion.mockResolvedValue(1);

      await expect(
        service.update({ id: 'cur', payload: validPayload({ role: 'coding' }) }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404 when the target id is missing', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.update({ id: 'nope', payload: validPayload() })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findLatest', () => {
    it('returns the row from the repo', async () => {
      repo.findLatestVersion.mockResolvedValue(fakeRow({ version: 5 }));
      const result = await service.findLatest(null, 'planning');
      expect(result.version).toBe(5);
    });

    it('404 when no active definition exists', async () => {
      repo.findLatestVersion.mockResolvedValue(null);
      await expect(service.findLatest(null, 'planning')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('delegates to repo', async () => {
      repo.softDelete.mockResolvedValue(fakeRow({ deletedAt: new Date() }));
      const result = await service.softDelete('row-id');
      expect(repo.softDelete).toHaveBeenCalledWith('row-id');
      expect(result.deletedAt).not.toBeNull();
    });
  });
});
