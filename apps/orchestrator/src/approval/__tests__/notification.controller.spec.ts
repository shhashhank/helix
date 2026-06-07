import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InAppInbox, InMemoryInAppInbox } from '@helix/notifications';
import request from 'supertest';
import { NotificationController } from '../notification.controller';
import { IN_APP_INBOX } from '../notification.tokens';

describe('NotificationController', () => {
  let app: INestApplication;
  let inbox: InAppInbox;

  beforeEach(async () => {
    inbox = new InMemoryInAppInbox();
    await inbox.append('alice', {
      notificationId: 'ntf-1',
      type: 'approval.requested',
      subject: 'Approval needed: deploy prod',
      body: 'please review',
      deliveredAt: '2026-06-08T10:00:00.000Z',
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: IN_APP_INBOX, useValue: inbox }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /notifications returns the address's in-app feed", async () => {
    const res = await request(app.getHttpServer()).get('/notifications?address=alice').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ notificationId: 'ntf-1', type: 'approval.requested' });
  });

  it('GET /notifications returns an empty feed for an unknown address', async () => {
    const res = await request(app.getHttpServer()).get('/notifications?address=nobody').expect(200);
    expect(res.body).toEqual([]);
  });
});
