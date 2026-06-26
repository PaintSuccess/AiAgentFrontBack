---
name: shopify-flow-skill-evolver
description: automatically evaluate completed repeatable paintaccess shopify operations to capture reusable workflow knowledge and decide whether to create or update shopify skills. use after a shopify operation, automation chain, failure recovery, new tool sequence, or recurring user request. only create or update skills when the change improves stability, speed, safety, or output quality; otherwise record an observation without changing production skills.
---

# Shopify Flow Skill Evolver

Use this skill at the end of repeatable Shopify operations.

## Objective

Continuously improve the skill system without creating noise.

## Decision rule

Create or update a skill only if the new information improves at least one:

- stability;
- speed;
- safety;
- output quality;
- repeatability;
- reduction of user clarification loops.

If not, do not change production skills.

## Evaluation workflow

1. Summarize the completed operation:
   - goal;
   - inputs;
   - tools used;
   - successful path;
   - failed/blocked attempts;
   - final state.
2. Determine whether the flow is repeatable.
3. Check whether an existing skill already covers it.
4. Decide:
   - no change;
   - update existing skill;
   - create new skill;
   - add backlog observation.
5. If changing skills, keep edits minimal and specific.
6. Preserve safety constraints.

## Update criteria

Update an existing skill when:

- a new failure mode was discovered;
- a safer identification step is needed;
- a tool sequence was proven to work;
- a template should be standardized;
- orchestration routing should change.

Create a new skill when:

- the flow is distinct;
- it will recur;
- no existing skill covers it clearly;
- it has concrete triggers and outputs.

## Do not update when

- the task was one-off;
- the new detail is customer-specific only;
- the change is merely wording preference;
- the skill would become too broad.

See `references/skill-update-decision-rubric.md`.
