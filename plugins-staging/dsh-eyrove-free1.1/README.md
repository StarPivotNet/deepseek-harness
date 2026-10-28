# dsh-eyrove-free

Registers `eyrove_free_image`. One call follows the free form at `https://eyrove.com/zh-cn/free-ai-image-generator`: it opens `POST /api/free-generations/session`, submits `{ prompt, size, locale, templateId, idempotencyKey }` to `POST /api/free-generations`, polls the job, then downloads `GET /api/free-generations/:id/result`. The image is written under the session workspace and stored with `attachments.saveImage`. The tool result includes an `image` content block. The client view is a keyed `tool.call.toolview` for `eyrove_free_image` and draws that block with the row's `loadImage`. It does not declare `tool.call.images`: that slot is already declared by the built-in `read_image` tool view, and a second declaration fails the whole loader entry.

The form takes a prompt of at most 5000 characters and one `size`: `720x1280`, `1280x720`, `1024x1024`, `1152x864`, `864x1152`, `1152x768`, `768x1152`, `1024x1280`, or `1280x1024`. The default is `720x1280`. `locale` defaults to `zh-cn`. Omit `templateId` for a free-form prompt. The site allows one active job per visitor, applies a daily allowance and a fairness limit, and usually takes 30-60 seconds plus queue time.

Install it yourself:

```
dsh plugin --profile desktop add C:\Users\yuluk\.dsh\plugins\dsh-eyrove-free
```

Restart the desktop profile after adding it. Package manifests are cached in-process.
