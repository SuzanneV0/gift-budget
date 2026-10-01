// Budget maths. Pure functions over an event with nested recipients/gifts.

// At or above this share of the budget we show "almost at budget".
export const NEAR_BUDGET = 0.9;

const num = (v) => (v == null || v === '' ? 0 : Number(v));

/** The event's overall budget, or null if none is set. */
export function eventBudget(event) {
  if (event.budget_mode === 'per_recipient') {
    const set = event.recipients.filter((r) => r.budget != null);
    return set.length ? set.reduce((s, r) => s + num(r.budget), 0) : null;
  }
  return event.total_budget == null ? null : num(event.total_budget);
}

export function spentOf(gifts) {
  return gifts.filter((g) => g.status === 'bought').reduce((s, g) => s + num(g.amount_spent), 0);
}

/** Expected cost of gifts not yet bought (their latest known price). */
export function plannedOf(gifts) {
  return gifts.filter((g) => g.status !== 'bought').reduce((s, g) => s + num(g.current_price), 0);
}

export function state(spent, budget) {
  if (budget == null) return 'none';
  if (spent > budget + 0.004) return 'over';
  if (budget === 0 ? spent > 0 : spent / budget >= NEAR_BUDGET) return 'near';
  return 'ok';
}

export function summary(event) {
  const budget = eventBudget(event);
  const spent = spentOf(event.gifts);
  const planned = plannedOf(event.gifts);
  return { budget, spent, planned, left: budget == null ? null : budget - spent, state: state(spent, budget) };
}

export function recipientSummary(event, recipient) {
  const gifts = event.gifts.filter((g) => g.recipient_id === recipient.id);
  const budget = recipient.budget == null ? null : num(recipient.budget);
  const spent = spentOf(gifts);
  return { budget, spent, planned: plannedOf(gifts), left: budget == null ? null : budget - spent, state: state(spent, budget) };
}

/**
 * What happens to the budgets if `amount` is spent on `gift`?
 * Returns one entry per affected budget (event, and recipient in per-person
 * mode) that would end up near or over its limit.
 */
export function purchaseWarnings(event, gift, amount) {
  const warnings = [];
  const others = event.gifts.filter((g) => g.id !== gift.id);
  const check = (label, budget, spentBefore) => {
    if (budget == null) return;
    const after = spentBefore + amount;
    const s = state(after, budget);
    if (s === 'over' || s === 'near') warnings.push({ label, budget, after, over: after - budget, state: s });
  };

  const recipient = event.recipients.find((r) => r.id === gift.recipient_id);
  if (event.budget_mode === 'per_recipient' && recipient) {
    check(`${recipient.name}'s budget`, recipient.budget == null ? null : num(recipient.budget),
      spentOf(others.filter((g) => g.recipient_id === recipient.id)));
  }
  check('the event budget', eventBudget(event), spentOf(others));
  return warnings;
}

/** Warning when the whole shopping list (bought + planned) exceeds the budget. */
export function listWarning(event, extra = 0) {
  const { budget, spent, planned } = summary(event);
  if (budget == null) return null;
  const total = spent + planned + extra;
  return total > budget + 0.004 ? { total, budget, over: total - budget } : null;
}
