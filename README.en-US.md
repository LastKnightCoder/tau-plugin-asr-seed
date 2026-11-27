# Doubao Speech Recognition

Adds Chinese and English speech recognition to Tau: live voice input as you speak, and recording transcription into timestamped transcripts.

## Getting Started

1. Open the [Doubao Speech console](https://console.volcengine.com/speech/new/), enable the services you need, and create an API Key under **API Key Management**:
   - **Live voice input**: Enable **Streaming Speech Recognition 2.0**, and confirm whether your account uses the **By duration** or **By concurrency** billing resource.
   - **Recording transcription**: Enable either the **standard** or **fast** tier of **Recorded File Recognition**.
2. Install and enable **Doubao Speech Recognition** from the Plugin Center.
3. Open this plugin's **Settings**, add an account, enter your API Key, select the matching **Billing resource** and recognition model, and save.
4. Select this account in Tau's speech settings to start using voice input or recording transcription.

## FAQ

**What is the difference between the standard and fast tiers for Recorded File Recognition?** The standard tier has no duration limit, but recordings must live in publicly accessible remote storage. The fast tier uploads recordings directly, up to 2 hours per task. When both are enabled, the standard tier is used first and falls back automatically to the fast tier if unavailable.

**Which audio formats are supported?** For recording transcription, MP3, WAV, and Ogg Opus files are sent to Doubao Speech as-is. Other formats (such as m4a from mobile recordings) are converted to Ogg Opus by Tau automatically before recognition.

**How are audio data and billing handled?** Recordings are managed by Tau and sent over a secure connection to Doubao Speech, with recognition charges billed to your configured account. The plugin does not store your recordings or transcripts. When a recording is stored remotely, Doubao Speech reads it by URL (and any converted copy stays in that same storage); when stored locally, it is uploaded directly for transcription and nowhere else. Recognition quality depends on audio clarity and service availability.

## Notes

- Voice input and recording transcription incur Doubao Speech charges; check your console for billing terms and usage.
- Treat your API Key like an account credential: keep it safe and never share it or include it in screenshots or issue reports.
