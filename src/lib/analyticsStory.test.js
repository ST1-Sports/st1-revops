import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOpenDeal,
  isWonDeal,
  daysUntilDate,
  daysSinceTouch,
  dealAttention,
  rankOpenDeals,
  rankWonDeals,
  rankAttentionDeals,
  buildKeyAccounts,
  analyticsKpis,
  pipelineByStage,
  dealsForFilter,
  storyBeats,
  doubleDownItems,
  matchesAnalyticsQuery,
  liveDealFromList,
  plusDaysISO,
  dealStagePatch,
} from './analyticsStory.js';

const NOW = Date.parse('2026-11-08T18:00:00Z');
const daysAgo = n => NOW - n * 86400000;

describe('isOpenDeal / isWonDeal', () => {
  it('treats Quoted/Follow-Up/On Hold as open and PO Received as closed', () => {
    assert.equal(isOpenDeal({ stage: 'Quoted' }), true);
    assert.equal(isOpenDeal({ stage: 'Follow-Up 1' }), true);
    assert.equal(isOpenDeal({ stage: 'On Hold' }), true);
    assert.equal(isOpenDeal({ stage: 'PO Received' }), false);
    assert.equal(isOpenDeal({ stage: 'Closed Won' }), false);
    assert.equal(isOpenDeal({ stage: 'Closed Lost' }), false);
    assert.equal(isWonDeal({ stage: 'Closed Won' }), true);
    assert.equal(isWonDeal({ stage: 'Quoted' }), false);
  });
});

describe('daysUntilDate', () => {
  it('compares YYYY-MM-DD on calendar days, not wall-clock', () => {
    assert.equal(daysUntilDate('2026-11-08', NOW), 0);
    assert.equal(daysUntilDate('2026-11-05', NOW), -3);
    assert.equal(daysUntilDate('2026-11-10', NOW), 2);
    assert.equal(daysUntilDate('', NOW), null);
  });
});

describe('dealAttention', () => {
  it('returns null for closed deals and current open ones', () => {
    assert.equal(dealAttention({ stage: 'Closed Won', followUpDate: '2026-01-01' }, NOW), null);
    assert.equal(dealAttention({
      stage: 'Quoted',
      followUpDate: '2026-11-20',
      lastTouch: daysAgo(2),
    }, NOW), null);
  });

  it('flags overdue follow-ups ahead of stale and missing dates', () => {
    const att = dealAttention({
      stage: 'Quoted',
      followUpDate: '2026-11-01',
      lastTouch: daysAgo(40),
    }, NOW);
    assert.equal(att.kind, 'overdue');
    assert.equal(att.urgency, 4);
    assert.match(att.reason, /overdue/);
  });

  it('flags due today / due soon, on hold, quiet 14d, and no follow-up', () => {
    assert.equal(dealAttention({ stage: 'Quoted', followUpDate: '2026-11-08' }, NOW).kind, 'due');
    assert.equal(dealAttention({ stage: 'Quoted', followUpDate: '2026-11-10' }, NOW).kind, 'due');
    assert.equal(dealAttention({ stage: 'On Hold', followUpDate: '2026-12-01', lastTouch: daysAgo(1) }, NOW).kind, 'hold');
    assert.equal(dealAttention({ stage: 'Quoted', followUpDate: '2026-12-01', lastTouch: daysAgo(14) }, NOW).kind, 'stale');
    assert.equal(dealAttention({ stage: 'Quoted', lastTouch: daysAgo(3) }, NOW).kind, 'nofollow');
  });
});

describe('rankAttentionDeals / rankOpenDeals', () => {
  const deals = [
    { id: 'a', name: 'Quiet big', stage: 'Quoted', value: 40000, lastTouch: daysAgo(20), followUpDate: '2026-12-01' },
    { id: 'b', name: 'Overdue small', stage: 'Follow-Up 1', value: 8000, followUpDate: '2026-11-01', lastTouch: daysAgo(2) },
    { id: 'c', name: 'Current', stage: 'Negotiating', value: 50000, followUpDate: '2026-11-20', lastTouch: daysAgo(1) },
    { id: 'd', name: 'Won', stage: 'Closed Won', value: 90000 },
  ];

  it('sorts attention by urgency then value, and skips current/won', () => {
    const ranked = rankAttentionDeals(deals, NOW);
    assert.deepEqual(ranked.map(d => d.id), ['b', 'a']);
    assert.equal(ranked[0].attentionKind, 'overdue');
  });

  it('ranks open deals by value and keeps On Hold, drops won', () => {
    const open = rankOpenDeals(deals);
    assert.deepEqual(open.map(d => d.id), ['c', 'a', 'b']);
  });

  it('ranks won deals by value', () => {
    assert.deepEqual(rankWonDeals(deals).map(d => d.id), ['d']);
  });
});

describe('buildKeyAccounts', () => {
  it('folds Hudson invoice onto Hudson High School and skips drafts', () => {
    const accounts = buildKeyAccounts({
      invoices: [
        { customer: 'Hudson', total: 12000, balance: 4000, status: 'overdue' },
        { customer: 'Hudson High School', total: 3000, balance: 0, status: 'paid' },
        { customer: 'Ghost Draft', total: 99999, balance: 99999, status: 'draft' },
        { customer: 'Voided', total: 1, balance: 1, status: 'void' },
      ],
      deals: [
        { id: '1', name: 'Uniforms', school: 'Hudson High School', stage: 'Quoted', value: 22000 },
        { id: '2', name: 'Sideline', school: 'Glenwood HS', stage: 'Quoted', value: 9000 },
        { id: '3', name: 'Old win', school: 'Lincoln', stage: 'Closed Won', value: 15000 },
      ],
      contacts: [
        { id: 'c1', fullName: 'Pat', school: 'Hudson High School' },
      ],
    });
    const names = accounts.map(a => a.name);
    assert.ok(names.includes('Hudson High School'));
    assert.ok(names.includes('Glenwood HS'));
    assert.ok(names.includes('Lincoln'));
    assert.equal(names.includes('Ghost Draft'), false);

    const hudson = accounts.find(a => a.name === 'Hudson High School');
    assert.equal(hudson.customer, true);
    assert.equal(hudson.invoiced, 15000);
    assert.equal(hudson.owed, 4000);
    assert.equal(hudson.pipeline, 22000);
    assert.equal(hudson.contacts.length, 1);

    // Customers (invoiced/won) sort ahead of pipeline-only prospects.
    assert.equal(accounts[0].customer, true);
    const glenwood = accounts.find(a => a.name === 'Glenwood HS');
    assert.equal(glenwood.customer, false);
    assert.equal(glenwood.pipeline, 9000);
  });
});

describe('analyticsKpis + storyBeats', () => {
  it('computes pipeline, win rate, attention, and story copy', () => {
    const deals = [
      { stage: 'Quoted', value: 10000, followUpDate: '2026-11-01' },
      { stage: 'Quoted', value: 5000, followUpDate: '2026-11-20', lastTouch: daysAgo(1) },
      { stage: 'Closed Won', value: 20000 },
      { stage: 'Closed Lost', value: 8000 },
    ];
    const accounts = buildKeyAccounts({
      invoices: [{ customer: 'Hudson High School', total: 20000, balance: 2000, status: 'partial' }],
      deals,
    });
    const kpis = analyticsKpis({ deals, invoices: [{ customer: 'Hudson High School', total: 20000, balance: 2000, status: 'partial' }], accounts }, NOW);
    assert.equal(kpis.openCount, 2);
    assert.equal(kpis.openPipeline, 15000);
    assert.equal(kpis.attentionCount, 1);
    assert.equal(kpis.wonTotal, 20000);
    assert.equal(kpis.winRate, 50);
    assert.equal(kpis.avgDeal, 20000);
    assert.equal(kpis.outstanding, 2000);
    assert.equal(kpis.customerCount, 1);
    const beats = storyBeats(kpis);
    assert.match(beats.openBit, /2 open deals/);
    assert.match(beats.attentionBit, /1 need a follow-up/);
    assert.match(beats.customerBit, /1 key customer/);
  });
});

describe('pipelineByStage / dealsForFilter / doubleDown', () => {
  const deals = [
    { id: 'q', name: 'Q', stage: 'Quoted', value: 10, followUpDate: '2026-11-01' },
    { id: 'n', name: 'N', stage: 'Negotiating', value: 30, followUpDate: '2026-11-20', lastTouch: daysAgo(1) },
    { id: 'w', name: 'W', stage: 'Closed Won', value: 40 },
  ];

  it('groups value by stage', () => {
    const rows = pipelineByStage(deals);
    assert.equal(rows.find(r => r.stage === 'Negotiating').value, 30);
    assert.equal(rows.find(r => r.stage === 'Quoted').count, 1);
  });

  it('filters open by stage and attention separately', () => {
    assert.deepEqual(dealsForFilter(deals, 'open', { now: NOW }).map(d => d.id), ['n', 'q']);
    assert.deepEqual(dealsForFilter(deals, 'open', { stage: 'Quoted', now: NOW }).map(d => d.id), ['q']);
    assert.deepEqual(dealsForFilter(deals, 'attention', { now: NOW }).map(d => d.id), ['q']);
    assert.deepEqual(dealsForFilter(deals, 'won').map(d => d.id), ['w']);
    assert.deepEqual(dealsForFilter(deals, 'story'), []);
  });

  it('surfaces overdue deals and outstanding customers to double down', () => {
    const attention = rankAttentionDeals(deals, NOW);
    const accounts = buildKeyAccounts({
      invoices: [{ customer: 'Hudson High School', total: 5000, balance: 5000, status: 'overdue' }],
      deals: [{ id: 'up', school: 'Hudson High School', stage: 'Quoted', value: 12000, followUpDate: '2026-12-01', lastTouch: daysAgo(1) }],
    });
    const items = doubleDownItems({ attentionDeals: attention, keyAccounts: accounts });
    assert.ok(items.some(i => i.kind === 'deal' && i.id === 'q'));
    assert.ok(items.some(i => i.kind === 'account' && i.label === 'outstanding'));
  });
});

describe('matchesAnalyticsQuery', () => {
  it('matches name/school/stage haystacks', () => {
    const row = { name: 'Varsity kit', school: 'Hudson High School', stage: 'Quoted', attention: '3d overdue' };
    assert.equal(matchesAnalyticsQuery(row, 'hudson'), true);
    assert.equal(matchesAnalyticsQuery(row, 'OVERDUE'), true);
    assert.equal(matchesAnalyticsQuery(row, 'glenwood'), false);
    assert.equal(matchesAnalyticsQuery(row, ''), true);
  });
});

describe('daysSinceTouch', () => {
  it('prefers lastTouch over createdAt', () => {
    assert.equal(daysSinceTouch({ lastTouch: daysAgo(5), createdAt: daysAgo(40) }, NOW), 5);
    assert.equal(daysSinceTouch({ createdAt: '2026-10-25T00:00:00Z' }, NOW), 14);
  });
});

describe('analytics deal modal helpers', () => {
  it('resolves the live deal by id after a stage change', () => {
    const deals = [
      { id: 'd1', name: 'Hudson', stage: 'Quoted', value: 22000 },
      { id: 'd2', name: 'Glenwood', stage: 'Negotiating', value: 9000 },
    ];
    assert.equal(liveDealFromList(deals, 'd1').name, 'Hudson');
    const next = deals.map(d => d.id === 'd1' ? { ...d, stage: 'Follow-Up 1' } : d);
    assert.equal(liveDealFromList(next, 'd1').stage, 'Follow-Up 1');
    assert.equal(liveDealFromList(next, 'missing'), null);
  });

  it('patches stage and lastTouch, and skips a no-op', () => {
    const deal = { id: 'd1', stage: 'Quoted' };
    const patch = dealStagePatch(deal, 'Negotiating', NOW);
    assert.deepEqual(patch, { id: 'd1', stage: 'Negotiating', lastTouch: NOW });
    assert.equal(dealStagePatch(deal, 'Quoted', NOW), null);
    assert.equal(plusDaysISO(7, Date.parse('2026-11-08T18:00:00Z')), '2026-11-15');
  });
});
