export type AuditEvent = Readonly<{
  auditId: string;
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  correlationId: string;
  metadata: Record<string, string | number | boolean>;
}>;

const auditEvents: AuditEvent[] = [];

export function recordAudit(event: Omit<AuditEvent, "auditId" | "timestamp">): AuditEvent {
  const auditEvent = Object.freeze({
    ...event,
    auditId: `audit_${String(auditEvents.length + 1).padStart(4, "0")}`,
    timestamp: new Date().toISOString(),
  });
  auditEvents.push(auditEvent);
  return auditEvent;
}

export function listAuditEvents(organizationId: string): AuditEvent[] {
  return auditEvents.filter((event) => event.organizationId === organizationId);
}

export function resetAuditForTests(): void {
  auditEvents.splice(0, auditEvents.length);
}
