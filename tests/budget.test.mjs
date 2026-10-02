// Unit tests for the budget maths (js/budget.js). Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../js/budget.js';

// A small per-person event: Mom $100, Dad $50, plus one gift for nobody.
function perPersonEvent() {
  return {
    budget_mode: 'per_recipient',
    total_budget: null,
    recipients: [
      { id: 'mom', name: 'Mom', budget: 100 },
      { id: 'dad', name: 'Dad', budget: 50 },
    ],
    gifts: [
      { id: 'g1', recipient_id: 'mom', status: 'bought', amount_spent: 80 },
      { id: 'g2', recipient_id: 'mom', status: 'wanted', current_price: 30 },
      { id: 'g3', recipient_id: 'dad', status: 'wanted', current_price: 20 },
      { id: 'g4', recipient_id: null, status: 'bought', amount_spent: 5 },
    ],
  };
}

function totalEvent(total_budget, gifts = []) {
  return { budget_mode: 'total', total_budget, recipients: [], gifts };
}

test('event budget is the total in "total" mode, or the sum of per-person budgets', () => {
  assert.equal(B.eventBudget(totalEvent(200)), 200);
  assert.equal(B.eventBudget(totalEvent(null)), null);
  assert.equal(B.eventBudget(perPersonEvent()), 150);
});

test('per-person mode with no budgets set has no budget', () => {
  const e = perPersonEvent();
  e.recipients.forEach((r) => (r.budget = null));
  assert.equal(B.eventBudget(e), null);
});

test('spent counts only bought gifts; planned counts only gifts still on the list', () => {
  const { gifts } = perPersonEvent();
  assert.equal(B.spentOf(gifts), 85);
  assert.equal(B.plannedOf(gifts), 50);
});

test('amounts stored as strings (as Postgres numeric arrives) are added as numbers', () => {
  const gifts = [
    { status: 'bought', amount_spent: '19.99' },
    { status: 'bought', amount_spent: '0.01' },
  ];
  assert.equal(B.spentOf(gifts), 20);
});

test('state: ok below 90%, near from 90%, over once spending exceeds the budget', () => {
  assert.equal(B.state(50, null), 'none');
  assert.equal(B.state(89.99, 100), 'ok');
  assert.equal(B.state(90, 100), 'near');
  assert.equal(B.state(100, 100), 'near');
  assert.equal(B.state(100.01, 100), 'over');
});

test('state: a zero budget is fine until anything is spent, then over', () => {
  assert.equal(B.state(0, 0), 'ok');
  assert.equal(B.state(1, 0), 'over');
});

test('summary reports budget, spent, planned, what is left and the state', () => {
  assert.deepEqual(B.summary(perPersonEvent()), { budget: 150, spent: 85, planned: 50, left: 65, state: 'ok' });
});

test('recipient summary only counts that person\'s gifts', () => {
  const e = perPersonEvent();
  const mom = B.recipientSummary(e, e.recipients[0]);
  assert.equal(mom.spent, 80);
  assert.equal(mom.planned, 30);
  assert.equal(mom.left, 20);
  assert.equal(mom.state, 'ok');
});

test('purchase warning: buying Mom\'s second gift for $30 puts her $10 over', () => {
  const e = perPersonEvent();
  const warnings = B.purchaseWarnings(e, e.gifts[1], 30);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].label, "Mom's budget");
  assert.equal(warnings[0].state, 'over');
  assert.equal(warnings[0].over, 10);
});

test('purchase warning: near the limit is reported as "near", not "over"', () => {
  const e = perPersonEvent();
  const [w] = B.purchaseWarnings(e, e.gifts[1], 12); // Mom: 80 + 12 = 92 of 100
  assert.equal(w.state, 'near');
});

test('purchase warning: a comfortable purchase raises no warning', () => {
  const e = perPersonEvent();
  assert.deepEqual(B.purchaseWarnings(e, e.gifts[2], 10), []); // Dad: 10 of 50
});

test('purchase warning ignores the gift\'s own previous amount when re-recording it', () => {
  const e = totalEvent(100, [{ id: 'a', status: 'bought', amount_spent: 95 }]);
  // Re-recording the same gift at $95 replaces its amount rather than doubling it.
  const [w] = B.purchaseWarnings(e, e.gifts[0], 95);
  assert.equal(w.after, 95);
  assert.equal(w.state, 'near');
});

test('list warning fires when bought + still-to-buy exceeds the budget', () => {
  const e = totalEvent(100, [
    { status: 'bought', amount_spent: 60 },
    { status: 'wanted', current_price: 30 },
  ]);
  assert.equal(B.listWarning(e), null);
  assert.deepEqual(B.listWarning(e, 20), { total: 110, budget: 100, over: 10 });
});
