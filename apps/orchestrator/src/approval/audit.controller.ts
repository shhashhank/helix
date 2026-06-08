import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditEvent, AuditLog, AuditQuery, AuditVerification, toCsv, toNdjson } from '@helix/audit';
import { AuditEventDto, AuditQueryDto, AuditVerificationDto } from './dto/audit.dto';
import { AUDIT_LOG } from './audit.tokens';

/** Minimal structural view of the HTTP response for file downloads (no express type dep). */
interface DownloadResponse {
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

function parseQuery(q: AuditQueryDto): AuditQuery {
  const limit = Number.parseInt(q.limit ?? '', 10);
  return {
    subjectType: q.subjectType,
    subjectId: q.subjectId,
    type: q.type,
    ...(Number.isFinite(limit) && limit >= 0 ? { limit } : {}),
  };
}

/** Read / verify / export the append-only audit log (HELIX-136). */
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(@Inject(AUDIT_LOG) private readonly auditLog: AuditLog) {}

  @Get()
  @ApiOperation({ summary: 'Query the audit log (filter by subject / type, limit to most-recent N)' })
  @ApiOkResponse({ type: AuditEventDto, isArray: true })
  list(@Query() query: AuditQueryDto): Promise<AuditEvent[]> {
    return this.auditLog.list(parseQuery(query));
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify the audit hash chain is intact (tamper check)' })
  @ApiOkResponse({ type: AuditVerificationDto })
  verify(): Promise<AuditVerification> {
    return this.auditLog.verify();
  }

  @Get('export')
  @ApiOperation({ summary: 'Export the (filtered) audit log as a download' })
  @ApiQuery({ name: 'format', required: false, enum: ['ndjson', 'csv'] })
  @ApiProduces('application/x-ndjson', 'text/csv')
  async export(
    @Query() query: AuditQueryDto,
    @Res() res: DownloadResponse,
    @Query('format') format = 'ndjson',
  ): Promise<void> {
    const events = await this.auditLog.list(parseQuery(query));
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
      res.send(toCsv(events));
      return;
    }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="audit.ndjson"');
    res.send(toNdjson(events));
  }
}
