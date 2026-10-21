# Demo video script (target: under 3 minutes; the recorded run is 1:53)

The video is recorded by `web/demo/record.mjs`, which drives the real UI against the running server with on-screen captions.
It is silent; the narration below is meant to be read over it (or removed, since the captions carry the story).

```bash
CARECIRCLE_DEMO_TIME=09:00 uv run carecircle        # needs the model key in .env
cd web && node demo/record.mjs                       # -> web/demo/out/carecircle-demo.webm
```

| Time | On screen | Narration |
|---|---|---|
| 0:00 | Sign-in page, demo directory | "Millions of families look after an older parent from far away, and the person who knows how they are today is the person alone at home. CareCircle gives that person a voice assistant, and the family a calm, trustworthy picture." |
| 0:06 | **Start the demo**: Asha on her Echo, Rohan (family admin) on his phone, side by side | "Six synthetic families, twenty-nine accounts, four roles. Asha is seventy-eight, with type 2 diabetes." |
| 0:08 | Asha: *"I took my metformin. I slept badly and my sugar this morning was 58."* Tool cards appear | "She just talks. Alexa picks the tools: it logs the dose, records the reading and checks the trend, and answers in a few warm sentences." |
| 0:25 | Developer view: live MCP traffic | "Every one of those is a call to our MCP server: permission-checked, bound to this one patient, and written to an audit log." |
| 0:30 | Family app: alert toast, signals | "Her son Rohan sees it at once: low sugar, poor sleep, and the family is told." |
| 0:35 | Asha: *"I fell in the bathroom and I can't get up."* | "Emergencies are not left to the model. The server upgrades the alert to urgent and speaks a fixed message: call 112 or 108. It can never say help is on the way, because it cannot call anyone." |
| 0:51 | **Run care watch** | "The care watch runs with nobody asking. It reads the whole record, decides whether the family needs to know, and writes the report." |
| 1:07 | Language picker, Hindi, a Hindi question | "Seven languages. Alexa+ in India covers English, Hindi and Hinglish today; the others are simulated and labelled that way." |
| 1:20 | Manage, Care plan, photo of a prescription | "A family admin manages the care plan. New prescription? Photograph it. The model reads it into a draft, and nothing is added until a person confirms." |
| 1:34 | Review screen: allergy and duplicate flags | "Code, not the model, checks it against the record: a sulfa allergy is blocked, a duplicate is flagged, 'once a week' is never scheduled daily." |
| 1:41 | Confirm; family app; activity log | "Every action is audited, and a family only ever sees its own people." |
| 1:47 | End card | "CareCircle: built for Alexa+ on an MCP server. Open source, MIT, on GitHub." |

## Before recording again

1. Restart the server so the care clock is pinned: `CARECIRCLE_DEMO_TIME=09:00`.
2. The recorder resets the demo data first and again at the end, so every take starts from the same story.
3. The live model replies vary a little from take to take, so check the video before uploading.

## Uploading (Devpost needs a public link)

Upload `web/demo/out/carecircle-demo.webm` to YouTube or Vimeo, set it to public or unlisted, and paste the link into Devpost.
The video file is git-ignored (about 27 MB).
