# smartflow-ai-public

Open templates and Claude skills from **Smartflow AI** by Hannah Kodad.

Smartflow AI helps individuals and small businesses use AI safely: data management, automations and AI workflows that stay transparent and under human control.

## What you find here

| Path | What it is |
| --- | --- |
| `templates/TEMPLATE.md` | Template for specifying an AI agent: purpose, boundaries, access, tests and version history. |
| `skills/data-guard/SKILL.md` | Claude skill for safe data management: no deleting, to-delete folders, GDPR levels, confirmation before risky actions, admin log. |

The skill instructions are written in Czech.

## Principles behind the work

1. **The human has the last word.** AI prepares, the person decides. Nothing is merged, shared or deleted without explicit confirmation.
2. **Nothing gets deleted by AI.** Files to delete go to a to-delete folder; a person deletes them after review.
3. **Data stays where it belongs.** Personal data does not leave the client's environment, and special categories of data (GDPR art. 9) get the strictest rules.
4. **Everything is traceable.** Sensitive actions are logged so they can be checked and reversed.

## How to use a skill

1. Download the `SKILL.md` file from the skill's folder.
2. Add it as a skill in Claude (in Claude Code: save it to `~/.claude/skills/<skill-name>/SKILL.md`).
3. Adapt the client names, folders and protection levels to your own setup.

A skill is a set of instructions, not a technical lock. For hard limits, combine it with technical controls such as access rights, branch protection or hooks.

## License

No license yet. You are welcome to read and learn from the content; ask before reusing it.

---

Hannah Kodad · Smartflow AI · #HannahKodad #SmartflowAI
