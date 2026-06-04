# App wake / load flow

**Arrows (solid only)**

| Arrow from | Meaning |
|------------|--------|
| **Inside a box** | Next step in that branch (full dependency). |
| **Subgraph border** | Partial dependency — needs something from that phase, not the last inner step only. |
| **No arrow** | No dependency; may still overlap in time. |

**Between containers:** at most **one** arrow per pair (target box is the whole phase, not a specific inner step).

| Type | Meaning |
|------|--------|
| **server** | Supabase |
| **cache** | localStorage |
| **state** | Zustand / React |
| **dexie-table** | IndexedDB entity tables |
| **dexie** | IndexedDB `meta` |
| **queue** | Outbound `sync_queue` rows |
| **events** | Realtime handlers |
| **skip** | Step not run offline |

```mermaid
flowchart TB
  subgraph BOOT["App wake"]
    W0["App wake / load"]
    W0 --> W1["Resolve actor: cache -> state"]
    W1 --> G15["Local DB upgrades: dexie-table + dexie"]
    G15 --> G16["Full re-download all lists: server -> dexie-table (offline: skip)"]
  end

  subgraph AUTH["Auth"]
    A1["Restore session: server -> state (offline: cache -> state)"]
    A1 --> A2["Load profile: dexie-table -> state"]
    A2 --> A6["Refresh profile: server -> dexie-table + state (offline: dexie-table -> state)"]
  end

  subgraph LISTS_LOCAL["Home lists — local first"]
    L3["Last overview snapshot: cache -> state"]
    L4["Build home cards: dexie-table -> state"]
    L5["Watch home changes: dexie-table -> state"]
    L3 --> L4
    L4 --> L5
  end

  subgraph LISTS_SERVER["Home lists — server sync"]
    L7["Fetch list overview: server -> cache + dexie-table + dexie (offline: skip)"]
    L7 --> L10["Refresh home cards: dexie-table -> state"]
    L10 --> L11["Schedule list downloads: server -> dexie (offline: skip)"]
    L11 --> L12["Download list contents: dexie -> server -> dexie-table (offline: skip)"]
  end

  subgraph BACKGROUND["Background (whole session)"]
    PENDING["Pending local edits: dexie-table -> queue"]
    PENDING --> BG["Send pending edits: queue -> server (offline: skip)"]
    RT["Realtime subscribe: server -> events (offline: skip)"]
    RT -->|DB change| RT_REFRESH["Realtime list refresh: server -> dexie-table (offline: skip)"]
  end

  subgraph USER_OPEN["User opens a list"]
    N2["Open list load: server -> dexie-table + state (offline: dexie-table -> state)"]
  end

  BOOT --> AUTH
  BOOT --> LISTS_LOCAL
  BOOT --> BACKGROUND
  AUTH --> LISTS_SERVER
  AUTH --> BACKGROUND
  LISTS_LOCAL --> USER_OPEN
```

**Between-container dependencies**

| Arrow | Meaning |
|-------|--------|
| `BOOT -->` Auth / local home / background | Actor resolved + Dexie restructure (schema ready; G16 optional, non-blocking). |
| `AUTH --> LISTS_SERVER` | **`get_user_lists` and mirror schedule** need signed-in `user` (`canFetchFromServerNow`). Guest or session-not-ready: server branch **skip**, Dexie-only warm only (via local home path). |
| `AUTH --> BACKGROUND` | Same signed-in `user` for realtime + outbound send. |
| `LISTS_LOCAL --> USER_OPEN` | Home list cards on screen before open-from-home. |
