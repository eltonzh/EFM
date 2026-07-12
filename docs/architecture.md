# EFM Architecture

```mermaid
graph TD
    subgraph Client["Browser (Client)"]
        A[index.html\nHome / EFM Logo]
        B[characters.html\nSign Up / Log In]
        C[about.html\nAbout EFM]
        D[hi.html\nWhat's Your Name?]
        E[notebook.html\nMath Lessons]
        F[games.html\nGame Hub]
        G[inventory.html\nCoins & Items]
        H[admin.html\nAdmin Panel]
        I[settings.html\nAccount Settings]
        J[group-chat.html\nEFM Group Chat]

        subgraph Games
            G1[game-golden-trail.html]
            G2[game-meteor-math.html]
            G3[game-meteor-math-easy.html]
            G4[game-bubble-pop.html]
            G5[game-exponential-mountaineer.html]
        end

        LS[(localStorage\nefm_coins\nmathCoins\nefm_user_name\nefm_account_code\nefm_game_bought_*)]
    end

    subgraph Server["Server (cursor-server.py · Port 8080)"]
        WS[WebSocket Handler]
        HTTP[Static File Server]

        subgraph Handlers
            R[register]
            L[login]
            CP[change_password]
            DA[delete_account]
            AG[admin_get_accounts]
            SI[save_identity]
            GI[get_identity]
            CH[chat]
        end

        subgraph Storage
            ACC[(accounts.json\nemail → hash, name,\ncode, signed_up)]
            IDS[(identities.json\ndevice_id → name,\ncode, fv, sfv)]
            CHAT[(chat_history.json\ndaily messages)]
        end
    end

    subgraph External
        GH[GitHub\neltonzh/EFM]
        GSC[Google Search Console\nefm.ai-taichi.com]
        SM[sitemap.xml\n7 pages]
    end

    %% User flow
    B -->|WebSocket: register/login| WS
    H -->|WebSocket: admin_get_accounts| WS
    J -->|WebSocket: chat| WS
    I -->|WebSocket: change_password| WS

    %% Server internals
    WS --> Handlers
    R --> ACC
    L --> ACC
    CP --> ACC
    DA --> ACC
    AG --> ACC
    SI --> IDS
    GI --> IDS
    CH --> CHAT

    %% Static files
    HTTP -->|serves .html, .js, .png| Client

    %% Game coin flow
    Games -->|read/write efm_coins| LS
    G -->|read/write efm_coins| LS
    inventory.html -->|reads mathCoins| LS

    %% Onboarding flow
    B -->|Sign up / Log in| C
    C -->|Continue| D
    D -->|saves name| A

    %% Deployment
    GH -->|dad pulls & restarts| Server
    SM -->|submitted to| GSC
```

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Home page — EFM logo, nav buttons, Let's Get Started |
| `characters.html` | Sign up / Log in form (cover page) |
| `about.html` | About EFM — shown after sign up |
| `hi.html` | Name entry — first name + last initial |
| `notebook.html` | Math lessons (chapters) |
| `games.html` | Game hub — buy and launch games |
| `inventory.html` | Coins, tickets, purchased items |
| `admin.html` | Admin panel — view all accounts (owner only) |
| `settings.html` | Account settings, password change |
| `group-chat.html` | Live group chat via WebSocket |

## Games

| Game | Coins on Win | Coins on Loss |
|------|-------------|---------------|
| Golden Trail | +100,000 | −100 (time up or quit) |
| Meteor Math | varies | varies |
| Meteor Math Easy | varies | varies |
| Bubble Pop | +10 | −5 |
| Exponential Mountaineer | varies | varies |

## Server

`cursor-server.py` runs on port 8080 and handles both:
- **HTTP** — serves all static files
- **WebSocket** — accounts, chat, cursors, identity
