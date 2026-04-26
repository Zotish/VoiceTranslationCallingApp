# VoiceTranslationCallingApp Architecture Diagram Package

Use the Mermaid code below directly in ChatGPT, Claude, Notion, Mermaid Live, or any diagram-capable tool.

## 1. Mermaid End-to-End Architecture Diagram

```mermaid
flowchart LR
    A["User A Browser<br/>React App"] --> A1["AuthContext"]
    A --> A2["SocketContext"]
    A --> A3["CallContext"]
    A --> A4["Speech Recognition"]
    A --> A5["WebRTC Mic Stream"]
    A --> A6["Translated Audio Player"]

    B["User B Browser<br/>React App"] --> B1["AuthContext"]
    B --> B2["SocketContext"]
    B --> B3["CallContext"]
    B --> B4["Speech Recognition"]
    B --> B5["WebRTC Mic Stream"]
    B --> B6["Translated Audio Player"]

    A5 <-->|"Live Audio via WebRTC"| B5

    A2 <-->|"Call Signaling<br/>offer / answer / ICE / status"| S["Node.js + Express + Socket.IO Server"]
    B2 <-->|"Call Signaling<br/>offer / answer / ICE / status"| S

    A4 -->|"Spoken Text"| S
    B4 -->|"Spoken Text"| S

    S --> T["Translation Service Layer<br/>Google Translate + MyMemory Fallback"]
    T --> V["Voice Output Layer"]

    V --> V1["ElevenLabs Cloned Voice"]
    V --> V2["Google TTS Fallback"]

    V1 -->|"Translated Audio"| A6
    V1 -->|"Translated Audio"| B6
    V2 -->|"Translated Audio"| A6
    V2 -->|"Translated Audio"| B6

    S <--> D["MongoDB Database"]

    D --> D1["Users"]
    D --> D2["Contacts"]
    D --> D3["Call Logs"]
    D --> D4["Voice Clone Metadata"]

    U["Settings Page"] -->|"Upload Voice Sample"| S
    S -->|"Clone Voice Request"| V1
```

## 2. Mermaid Sequence Diagram

```mermaid
sequenceDiagram
    participant UA as User A Browser
    participant SB as Socket.IO Backend
    participant UB as User B Browser
    participant TR as Translation Service
    participant VO as Voice Output Layer
    participant DB as MongoDB

    UA->>SB: Register / Login
    SB->>DB: Store / Validate user
    UA->>SB: Add contact
    SB->>DB: Store contact

    UA->>SB: Call user
    SB->>UB: Incoming call
    UB->>SB: Accept call
    SB->>UA: Call accepted

    UA->>UB: WebRTC offer/answer/ICE
    UB->>UA: WebRTC live audio

    UA->>SB: translate-text (captured speech)
    SB->>TR: Translate source language to target language
    TR-->>SB: Translated text
    SB->>VO: Generate translated voice
    VO-->>SB: Audio output
    SB->>UB: text-translated + audio

    UB->>SB: translate-text (reply speech)
    SB->>TR: Translate reply
    TR-->>SB: Translated reply
    SB->>VO: Generate translated reply voice
    VO-->>SB: Audio output
    SB->>UA: text-translated + audio

    UA->>SB: End call
    SB->>DB: Save call history
```

## 3. High-Quality Prompt For ChatGPT Diagram Rendering

Paste the prompt below into ChatGPT if you want it to create a more artistic or presentation-style architecture diagram:

```text
Create a polished end-to-end system architecture diagram for a project called VoiceTranslationCallingApp.

The diagram should show two browser clients, User A and User B, both running a React frontend. Each client contains AuthContext, SocketContext, CallContext, browser Speech Recognition, WebRTC microphone/audio stream, and a translated audio playback layer.

Show a direct peer-to-peer WebRTC connection between User A and User B for live voice audio.

Show both clients connected to a Node.js + Express + Socket.IO backend. The backend is responsible for user authentication, contact management, call signaling, translation events, voice routing, and call history logging.

From the backend, show a translation service layer that uses Google Translate as the primary engine and MyMemory as fallback.

After translation, show a voice output layer with two branches:
1. ElevenLabs cloned voice for personalized translated output
2. Google TTS fallback when cloned voice is unavailable

Show a MongoDB database connected to the backend with four main collections or data groups:
- Users
- Contacts
- Call Logs
- Voice Clone Metadata

Also show a Settings / Voice Clone upload flow from the client to the backend and from the backend to ElevenLabs for voice cloning.

The final diagram should look clean, modern, professional, startup-grade, and presentation-ready. Use clear arrows, distinct colors for transport, translation, storage, and voice layers, and make the system understandable to both technical and non-technical viewers.
```

## 4. Suggested Visual Grouping

When designing the diagram, group components into these zones:

- Client Layer
- Real-Time Transport Layer
- Backend Application Layer
- AI Translation and Voice Layer
- Data Layer
- Deployment Layer

## 5. Optional Deployment Diagram Prompt

```text
Create a deployment architecture diagram for VoiceTranslationCallingApp showing:
- Netlify hosting the React frontend
- Railway hosting the Node.js + Express + Socket.IO backend
- MongoDB connected to the backend
- External translation APIs
- External ElevenLabs voice clone service
- End users accessing the system through browsers on desktop or mobile

Use a cloud-native, clean, modern diagram style.
```
