// The write entry point must refuse a funnel whose funnelSteps cannot be
// resolved — otherwise the query layer would have to guess, or the report
// would be saved unopenable.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, requireProjectAccessMock } = vi.hoisted(() => ({
  dbMock: {
    dashboard: { findUniqueOrThrow: vi.fn() },
    report: { create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  },
  requireProjectAccessMock: vi.fn(),
}));

vi.mock('@openpanel/db', () => ({
  db: dbMock,
  getDashboardById: vi.fn(),
  getReportById: vi.fn(),
  getReportsByDashboardId: vi.fn(),
  canWriteProject: (access: { level?: string }) =>
    access.level === 'write' || access.level === 'admin',
  // ../access re-exports these from @openpanel/db; the router's own imports
  // (requireProjectAccess) live in ../access and are mocked separately below.
  getProjectAccess: vi.fn(),
  getOrganizationAccess: vi.fn(),
  getClientAccess: vi.fn(),
  getProjectById: vi.fn(),
  runWithAlsSession: (_id: string | null, fn: () => unknown) => fn(),
}));

// The router imports requireProjectAccess from '../access' (not the db
// package). Mock the module's own function; keep its re-exports intact.
vi.mock('../access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../access')>();
  return { ...actual, requireProjectAccess: requireProjectAccessMock };
});

const { reportRouter } = await import('./report');

const PROJECT_ID = 'project-1';

function caller() {
  return reportRouter.createCaller({
    session: { userId: 'user-1', session: { id: 'session-1' } },
    req: { log: { info: vi.fn() } },
    res: {},
    setCookie: vi.fn(),
    cookies: {},
  } as never);
}

const event = (id: string, name = `e_${id}`) => ({
  id,
  type: 'event' as const,
  name,
  segment: 'event' as const,
  filters: [],
});

const funnelReport = (overrides: Record<string, unknown>) => ({
  name: 'Funnel',
  chartType: 'funnel' as const,
  lineType: 'monotone' as const,
  interval: 'day' as const,
  breakdowns: [],
  range: '30d' as const,
  previous: false,
  metric: 'sum' as const,
  series: [event('a'), event('b')],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.dashboard.findUniqueOrThrow.mockResolvedValue({
    id: 'dash-1',
    projectId: PROJECT_ID,
  });
  dbMock.report.findUniqueOrThrow.mockResolvedValue({
    id: 'report-1',
    projectId: PROJECT_ID,
  });
  dbMock.report.create.mockResolvedValue({ id: 'report-1' });
  dbMock.report.update.mockResolvedValue({ id: 'report-1' });
  requireProjectAccessMock.mockResolvedValue(undefined);
});

describe('report.create — funnel step validation', () => {
  it('rejects a dangling funnelSteps reference', async () => {
    await expect(
      caller().create({
        dashboardId: 'dash-1',
        report: funnelReport({
          options: {
            type: 'funnel',
            funnelSteps: [{ id: 's1', eventIds: ['nope'] }],
          },
        }),
      } as never),
    ).rejects.toThrow(/unknown event configuration nope/);
    expect(dbMock.report.create).not.toHaveBeenCalled();
  });

  it('rejects funnelSteps present but empty', async () => {
    await expect(
      caller().create({
        dashboardId: 'dash-1',
        report: funnelReport({ options: { type: 'funnel', funnelSteps: [] } }),
      } as never),
    ).rejects.toThrow(/at least one step/);
  });

  it('rejects more than 26 event configurations', async () => {
    await expect(
      caller().create({
        dashboardId: 'dash-1',
        report: funnelReport({
          series: Array.from({ length: 27 }, (_, i) => event(`id${i}`)),
        }),
      } as never),
    ).rejects.toThrow(/at most 26/);
  });

  it('saves a valid multi-event funnel', async () => {
    await caller().create({
      dashboardId: 'dash-1',
      report: funnelReport({
        options: {
          type: 'funnel',
          funnelSteps: [
            { id: 's1', eventIds: ['a'] },
            { id: 's2', eventIds: ['b'] },
          ],
        },
      }),
    } as never);
    expect(dbMock.report.create).toHaveBeenCalledTimes(1);
  });
});

describe('report.update — funnel step validation', () => {
  it('rejects an event referenced by two steps', async () => {
    await expect(
      caller().update({
        reportId: 'report-1',
        report: funnelReport({
          options: {
            type: 'funnel',
            funnelSteps: [
              { id: 's1', eventIds: ['a'] },
              { id: 's2', eventIds: ['a', 'b'] },
            ],
          },
        }),
      } as never),
    ).rejects.toThrow(/more than one funnel step/);
    expect(dbMock.report.update).not.toHaveBeenCalled();
  });
});
