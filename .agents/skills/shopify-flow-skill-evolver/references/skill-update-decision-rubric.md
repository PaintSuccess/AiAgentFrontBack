# Skill update decision rubric

Score each candidate change from 0 to 2.

## Stability

- 0: no effect
- 1: avoids minor confusion
- 2: prevents likely failure or wrong Shopify action

## Speed

- 0: no time saved
- 1: reduces one clarification/tool step
- 2: removes repeated multi-step work

## Safety

- 0: no safety effect
- 1: makes a warning clearer
- 2: prevents destructive/financial mistake

## Output quality

- 0: no improvement
- 1: improves wording/template consistency
- 2: materially improves completeness or customer-facing quality

## Repeatability

- 0: one-off situation
- 1: likely to recur but rare
- 2: common workflow or explicitly requested reusable pipeline

## Rule

Update or create a skill only when total score is at least 2 and the improvement is reusable.

Prefer a backlog observation over a skill edit when the evidence is weak, the workflow was not completed successfully, or the missing behavior depends on secrets/account setup rather than skill knowledge.

## Live Agent Safety

- Local skill files are source of truth for development, not proof that ChatGPT agents are updated.
- Upload/install into live agents only after the user approves or the current task explicitly asks to update agents.
- Always report whether the live agent has the changed skill copy.
