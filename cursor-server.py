import asyncio, json, random, os, mimetypes, datetime, time, zoneinfo, hashlib, urllib.request, urllib.error
try:
    _TZ = zoneinfo.ZoneInfo('America/Los_Angeles')
except Exception:
    _TZ = datetime.timezone.utc
from pathlib import Path
import websockets
from websockets import Response
from websockets.datastructures import Headers
from openai import AsyncOpenAI

REPO_DIR = Path(__file__).parent.resolve()
CHAT_FILE     = REPO_DIR / 'chat_history.json'
IDENTITY_FILE = REPO_DIR / 'identities.json'

# Unambiguous chars (no I, O, 0, 1)
CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

ACCOUNTS_FILE = REPO_DIR / 'accounts.json'

def load_accounts():
    if ACCOUNTS_FILE.exists():
        try:
            return json.loads(ACCOUNTS_FILE.read_text())
        except Exception:
            pass
    return {}

def save_accounts():
    ACCOUNTS_FILE.write_text(json.dumps(accounts))

def load_identities():
    if IDENTITY_FILE.exists():
        try:
            return json.loads(IDENTITY_FILE.read_text())
        except Exception:
            pass
    return {'by_device': {}, 'by_code': {}}

def save_identities_file():
    IDENTITY_FILE.write_text(json.dumps(identity_store))

def initials_from_name(name):
    parts = name.strip().split()
    if not parts:
        return 'XX'
    first_init = parts[0][0].upper() if parts[0] else 'X'
    if len(parts) >= 2:
        last_part = parts[-1]
        # "Z." format (last initial with dot)
        if len(last_part) == 2 and last_part[1] == '.':
            last_init = last_part[0].upper()
        else:
            last_init = last_part[0].upper()
    else:
        # No last initial — use second letter of first name
        last_init = parts[0][1].upper() if len(parts[0]) > 1 else 'X'
    return first_init + last_init

SUFFIX_CHARS = '0123456789!@#$%&*+'

def generate_code(name=''):
    prefix = initials_from_name(name) if name else 'XX'
    for _ in range(100):
        suffix = ''.join(random.choice(SUFFIX_CHARS) for _ in range(3))
        code = prefix + suffix
        if code not in identity_store['by_code']:
            return code
    return prefix + ''.join(random.choice(SUFFIX_CHARS) for _ in range(5))

MAX_NAME_LEN      = 40
MAX_TEXT_LEN      = 1000
MAX_ID_LEN        = 64
MAX_MSG_BYTES     = 65_536   # 64 KB hard cap per WebSocket message
MAX_HISTORY_ITEMS = 6        # history items client may send for Math Helper context

LOCAL_LLM_BASE_URL        = os.environ.get('LOCAL_LLM_BASE_URL', 'http://127.0.0.1:8002/v1')
LOCAL_LLM_API_KEY         = os.environ.get('LOCAL_LLM_API_KEY') or 'not-needed'
LOCAL_LLM_MODEL           = os.environ.get('LOCAL_LLM_MODEL', '')
LOCAL_LLM_TIMEOUT_SECONDS = float(os.environ.get('LOCAL_LLM_TIMEOUT_SECONDS', '45'))
LOCAL_LLM_MAX_TOKENS      = int(os.environ.get('LOCAL_LLM_MAX_TOKENS', '400'))
LOCAL_LLM_CONCURRENCY     = int(os.environ.get('LOCAL_LLM_CONCURRENCY', '1'))

def load_chat_history():
    if CHAT_FILE.exists():
        try:
            data = json.loads(CHAT_FILE.read_text())
            if data.get('date') == datetime.datetime.now(_TZ).date().isoformat():
                return data.get('messages', [])
        except Exception:
            pass
    return []

def save_chat_history():
    CHAT_FILE.write_text(json.dumps({'date': datetime.datetime.now(_TZ).date().isoformat(), 'messages': chat_history}))

def check_daily_reset():
    if CHAT_FILE.exists():
        try:
            data = json.loads(CHAT_FILE.read_text())
            if data.get('date') != datetime.datetime.now(_TZ).date().isoformat():
                chat_history.clear()
                save_chat_history()
        except Exception:
            pass

def now_iso():
    return datetime.datetime.utcnow().isoformat() + 'Z'

async def process_request(connection, request):
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return None  # let WebSocket upgrade proceed normally
    path = request.path.split('?')[0].lstrip('/')
    if not path:
        path = 'index.html'
    # Prevent path traversal — resolve and confirm it stays inside REPO_DIR
    file_path = (REPO_DIR / path).resolve()
    if not str(file_path).startswith(str(REPO_DIR) + os.sep) and file_path != REPO_DIR:
        return Response(403, 'Forbidden', Headers([('Content-Type', 'text/plain')]), b'Forbidden')
    if file_path.is_file():
        mime, _ = mimetypes.guess_type(str(file_path))
        body = file_path.read_bytes()
        no_cache = mime and (mime.startswith('text/') or mime in ('application/javascript',))
        headers = [
            ('Content-Type', mime or 'application/octet-stream'),
            ('Content-Length', str(len(body))),
        ]
        if no_cache:
            headers.append(('Cache-Control', 'no-cache'))
        return Response(200, 'OK', Headers(headers), body)
    return Response(404, 'Not Found', Headers([('Content-Type', 'text/plain')]), b'Not found')

# 36 colors evenly spread around the hue wheel — vibrant, all distinct
COLORS = [f'hsl({h * 10}, 82%, 56%)' for h in range(36)]

# Resend API key — loaded from env var or local resend.key file (gitignored)
_resend_key_file = REPO_DIR / 'resend.key'
RESEND_API_KEY = os.environ.get('RESEND_API_KEY') or (_resend_key_file.read_text().strip() if _resend_key_file.exists() else '')

pending_verifications = {}  # email -> {code, expires, name, password_hash}

async def send_signup_notification(name, user_email):
    """Notify site owner of a new signup. Always sends to owner's email (Resend testing restriction)."""
    if not RESEND_API_KEY:
        print('[email] RESEND_API_KEY not set — skipping signup notification')
        return
    payload = json.dumps({
        'from': 'EFM <onboarding@resend.dev>',
        'to': ['eltonzhang0328@gmail.com'],
        'subject': 'EFM: New account signup',
        'html': (
            '<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;">'
            '<h2 style="color:#0f0f13;margin-bottom:8px;">New EFM Signup</h2>'
            f'<p style="color:#555;margin-bottom:8px;"><strong>Name:</strong> {name}</p>'
            f'<p style="color:#555;margin-bottom:24px;"><strong>Email:</strong> {user_email}</p>'
            '<p style="color:#888;font-size:0.9rem;">Account access pending. This may take a few days.</p>'
            '</div>'
        )
    }).encode()
    req = urllib.request.Request(
        'https://api.resend.com/emails',
        data=payload,
        headers={'Authorization': f'Bearer {RESEND_API_KEY}', 'Content-Type': 'application/json'}
    )
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=10))
        print(f'[email] Signup notification sent for {user_email}')
    except Exception as e:
        print(f'[email] Signup notification error: {e}')

clients        = {}    # websocket -> {id, name, color}
chat_clients   = set() # websockets that are in the chat room
chat_names     = {}   # websocket -> display name for chat
chat_history   = load_chat_history()
identity_store = load_identities()  # {by_device: {device_id: {...}}, by_code: {code: device_id}}
accounts       = load_accounts()    # {email: {password_hash, name, fv, sfv, code}}
MAX_HISTORY  = 500

llm_client    = AsyncOpenAI(base_url=LOCAL_LLM_BASE_URL, api_key=LOCAL_LLM_API_KEY,
                            timeout=LOCAL_LLM_TIMEOUT_SECONDS, max_retries=0)
llm_semaphore = asyncio.Semaphore(LOCAL_LLM_CONCURRENCY)

AI_TUTOR_SYSTEM_PROMPT = (
    "You are Math Helper, a friendly, patient math tutor for elementary and middle-school kids on the "
    "EFM math learning website. Explain ideas simply, be encouraging, and guide students step by step "
    "rather than just handing over homework answers. Keep replies short (a few sentences, well under "
    "150 words). This is a children's site — keep everything age-appropriate."
)
AI_TUTOR_FALLBACK_MESSAGE = "Oops, my brain took a little nap! Try asking me again in a moment."

free_colors = list(COLORS)
random.shuffle(free_colors)

def pick_color():
    if free_colors:
        return free_colors.pop()
    return f'hsl({random.randint(0, 359)}, 82%, 56%)'

def release_color(color):
    if color in COLORS and color not in free_colors:
        free_colors.append(color)

async def broadcast_cursors(data, exclude=None):
    msg = json.dumps(data)
    for ws in list(clients):
        if ws is not exclude:
            try:
                await ws.send(msg)
            except Exception:
                pass

async def broadcast_chat(data):
    msg = json.dumps(data)
    for ws in list(chat_clients):
        try:
            await ws.send(msg)
        except Exception:
            pass

async def handle_ai_chat(websocket, data, reply_type):
    text = str(data.get('text', ''))[:MAX_TEXT_LEN].strip()
    if not text:
        return
    if not LOCAL_LLM_MODEL:
        print(f'[{reply_type}] LOCAL_LLM_MODEL is not configured; skipping call')
        await websocket.send(json.dumps({'type': reply_type, 'text': AI_TUTOR_FALLBACK_MESSAGE}))
        return

    raw_history = data.get('history')
    history = raw_history if isinstance(raw_history, list) else []
    messages = [{'role': 'system', 'content': AI_TUTOR_SYSTEM_PROMPT}]
    for item in history[-MAX_HISTORY_ITEMS:]:
        if not isinstance(item, dict):
            continue
        role = 'user' if item.get('who') == 'user' else 'assistant'
        content = str(item.get('text', ''))[:MAX_TEXT_LEN].strip()
        if content:
            messages.append({'role': role, 'content': content})
    messages.append({'role': 'user', 'content': text})

    try:
        async with llm_semaphore:
            completion = await llm_client.chat.completions.create(
                model=LOCAL_LLM_MODEL,
                messages=messages,
                max_tokens=LOCAL_LLM_MAX_TOKENS,
                temperature=0.7,
            )
        reply_text = (completion.choices[0].message.content or '').strip() or AI_TUTOR_FALLBACK_MESSAGE
    except Exception as e:
        print(f'[{reply_type}] local LLM call failed: {type(e).__name__}: {e}')
        reply_text = AI_TUTOR_FALLBACK_MESSAGE

    await websocket.send(json.dumps({'type': reply_type, 'text': reply_text}))

async def handler(websocket):
    color = None
    try:
        async for raw in websocket:
            # Drop oversized messages before parsing
            if isinstance(raw, (bytes, str)) and len(raw) > MAX_MSG_BYTES:
                continue
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(data, dict):
                continue
            kind = data.get('type')

            # ── cursor events ──────────────────────────────────────────
            if kind == 'join':
                name = str(data.get('name', 'Guest'))[:MAX_NAME_LEN].strip() or 'Guest'
                cid  = str(data.get('id',   ''))[:MAX_ID_LEN]
                existing_names = {v['name'] for v in clients.values()}
                display_name = name
                if display_name in existing_names:
                    n = 2
                    while f'{name} {n}' in existing_names:
                        n += 1
                    display_name = f'{name} {n}'
                color = pick_color()
                info  = {'id': cid, 'name': display_name, 'color': color}
                clients[websocket] = info
                await websocket.send(json.dumps({'type': 'color_assign', 'color': color, 'name': display_name}))
                existing = [v for k, v in clients.items() if k is not websocket]
                if existing:
                    await websocket.send(json.dumps({'type': 'init', 'cursors': existing}))
                await broadcast_cursors({'type': 'join', **info}, exclude=websocket)

            elif kind == 'move':
                # Only relay validated numeric coords + known id — never forward raw data
                try:
                    x = float(data.get('x', 0))
                    y = float(data.get('y', 0))
                    cid = str(data.get('id', ''))[:MAX_ID_LEN]
                    await broadcast_cursors({'type': 'move', 'id': cid, 'x': x, 'y': y}, exclude=websocket)
                except (TypeError, ValueError):
                    pass

            # ── chat events ────────────────────────────────────────────
            elif kind == 'chat_join':
                chat_clients.add(websocket)
                session_id = str(data.get('session_id', ''))[:64]
                raw_name  = str(data.get('name', 'Guest'))[:MAX_NAME_LEN].strip() or 'Guest'
                acct_code = str(data.get('code', ''))[:64].strip()
                # Deduplicate: same code = same person (no suffix); different code, same name = add suffix
                existing_names = {info['name'] for ws, info in chat_names.items() if ws is not websocket}
                existing_codes = {info['code'] for ws, info in chat_names.items() if ws is not websocket and info['code']}
                if acct_code and acct_code in existing_codes:
                    # Same account reconnecting — evict old connection's name entry to give them their real name
                    for ws, info in list(chat_names.items()):
                        if info['code'] == acct_code and ws is not websocket:
                            del chat_names[ws]
                            existing_names.discard(info['name'])
                display_name = raw_name
                if display_name in existing_names:
                    n = 2
                    while f'{raw_name} {n}' in existing_names:
                        n += 1
                    display_name = f'{raw_name} {n}'
                chat_names[websocket] = {'name': display_name, 'code': acct_code}
                if websocket in clients:
                    clients[websocket]['session_id'] = session_id
                check_daily_reset()
                await websocket.send(json.dumps({'type': 'chat_history', 'messages': chat_history}))

            elif kind == 'chat':
                check_daily_reset()
                name = (chat_names.get(websocket) or {}).get('name') or str(data.get('name', 'Guest'))[:MAX_NAME_LEN].strip() or 'Guest'
                session_id = clients.get(websocket, {}).get('session_id', '')
                text = str(data.get('text', ''))[:MAX_TEXT_LEN].strip()
                if not text:
                    continue
                # Use server timestamp — never trust client-supplied time
                msg = {'name': name, 'text': text, 'time': now_iso()}
                chat_history.append(msg)
                if len(chat_history) > MAX_HISTORY:
                    chat_history.pop(0)
                save_chat_history()
                await broadcast_chat({'type': 'chat', 'session_id': session_id, **msg})

            elif kind == 'ask_claude':
                await handle_ai_chat(websocket, data, 'claude_reply')

            elif kind == 'ask_chatgpt':
                await handle_ai_chat(websocket, data, 'gpt_reply')

            elif kind == 'send_verification':
                email    = str(data.get('email',    '')).lower().strip()[:120]
                password = str(data.get('password', ''))[:200]
                name     = str(data.get('name',     ''))[:MAX_NAME_LEN].strip()
                if not email or '@' not in email or not password or not name:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'Please fill in all fields.'}))
                    continue
                if len(password) < 6:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'Password must be at least 6 characters.'}))
                    continue
                if email in accounts:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'That email is already registered.'}))
                    continue
                vcode   = str(random.randint(100000, 999999))
                pw_hash = hashlib.sha256(password.encode()).hexdigest()
                pending_verifications[email] = {'code': vcode, 'expires': time.time() + 600, 'name': name, 'password_hash': pw_hash}
                ok = await send_verification_email(email, vcode)
                if ok:
                    await websocket.send(json.dumps({'type': 'verification_sent', 'email': email}))
                else:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'Could not send verification email. Please try again.'}))

            elif kind == 'verify_code':
                email = str(data.get('email', '')).lower().strip()[:120]
                vcode = str(data.get('code',  '')).strip()
                pending = pending_verifications.get(email)
                if not pending:
                    await websocket.send(json.dumps({'type': 'verify_error', 'message': 'No pending verification. Please sign up again.'}))
                    continue
                if time.time() > pending['expires']:
                    del pending_verifications[email]
                    await websocket.send(json.dumps({'type': 'verify_error', 'message': 'Code expired. Please sign up again.'}))
                    continue
                if pending['code'] != vcode:
                    await websocket.send(json.dumps({'type': 'verify_error', 'message': 'Incorrect code. Try again.'}))
                    continue
                name    = pending['name']
                pw_hash = pending['password_hash']
                del pending_verifications[email]
                if email in accounts:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'That email is already registered.'}))
                    continue
                code = generate_code(name)
                accounts[email] = {'password_hash': pw_hash, 'name': name, 'fv': '', 'sfv': '', 'code': code, 'signed_up': now_iso()}
                identity_store['by_code'][code]              = 'email:' + email
                identity_store['by_device']['email:' + email] = {'name': name, 'fv': '', 'sfv': '', 'code': code}
                save_accounts()
                save_identities_file()
                await websocket.send(json.dumps({'type': 'register_ok', 'code': code, 'name': name}))

            elif kind == 'register':
                email    = str(data.get('email',    '')).lower().strip()[:120]
                password = str(data.get('password', ''))[:200]
                name     = str(data.get('name',     ''))[:MAX_NAME_LEN].strip()
                if not email or '@' not in email or not password or not name:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'Please fill in all fields.'}))
                    continue
                if len(password) < 6:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'Password must be at least 6 characters.'}))
                    continue
                if email in accounts:
                    await websocket.send(json.dumps({'type': 'register_error', 'message': 'That email is already registered. Use your account code to log in.'}))
                    continue
                pw_hash = hashlib.sha256(password.encode()).hexdigest()
                code    = generate_code(name)
                accounts[email] = {'password_hash': pw_hash, 'name': name, 'fv': '', 'sfv': '', 'code': code, 'signed_up': now_iso()}
                identity_store['by_code'][code]             = 'email:' + email
                identity_store['by_device']['email:' + email] = {'name': name, 'fv': '', 'sfv': '', 'code': code}
                save_accounts()
                save_identities_file()
                asyncio.create_task(send_signup_notification(name, email))
                await websocket.send(json.dumps({'type': 'register_ok', 'code': code, 'name': name}))

            elif kind == 'save_identity':
                device_id = str(data.get('device_id', ''))[:64].strip()
                name      = str(data.get('name', ''))[:MAX_NAME_LEN].strip()
                fv        = str(data.get('fv',  ''))[:64].strip()
                sfv       = str(data.get('sfv', ''))[:64].strip()
                if device_id and name:
                    existing = identity_store['by_device'].get(device_id, {})
                    code = existing.get('code') or generate_code(name)
                    identity_store['by_device'][device_id] = {'name': name, 'fv': fv, 'sfv': sfv, 'code': code}
                    identity_store['by_code'][code] = device_id
                    save_identities_file()
                    await websocket.send(json.dumps({'type': 'identity_saved', 'code': code}))

            elif kind == 'get_identity':
                device_id = str(data.get('device_id', ''))[:64].strip()
                record    = identity_store['by_device'].get(device_id)
                await websocket.send(json.dumps({'type': 'identity_data', 'identity': record}))

            elif kind == 'get_identity_by_code':
                code      = str(data.get('code', '')).upper().strip()[:8]
                device_id = identity_store['by_code'].get(code)
                record    = identity_store['by_device'].get(device_id) if device_id else None
                await websocket.send(json.dumps({'type': 'identity_data', 'identity': record, 'from_code': True}))

            elif kind == 'login':
                email    = str(data.get('email',    '')).lower().strip()[:120]
                password = str(data.get('password', ''))[:200]
                if not email or not password:
                    await websocket.send(json.dumps({'type': 'login_error', 'message': 'Please fill in all fields.'}))
                    continue
                if email not in accounts:
                    await websocket.send(json.dumps({'type': 'login_error', 'message': 'No account found. Please try again.'}))
                    continue
                pw_hash = hashlib.sha256(password.encode()).hexdigest()
                if accounts[email]['password_hash'] != pw_hash:
                    await websocket.send(json.dumps({'type': 'login_error', 'message': 'Incorrect password.'}))
                    continue
                record = identity_store['by_device'].get('email:' + email, {})
                name   = record.get('name') or accounts[email].get('name', '')
                code   = record.get('code') or accounts[email].get('code', '')
                await websocket.send(json.dumps({'type': 'login_ok', 'name': name, 'fv': record.get('fv', ''), 'sfv': record.get('sfv', ''), 'code': code}))

            elif kind == 'change_password':
                code         = str(data.get('code', '')).upper().strip()[:8]
                new_password = str(data.get('new_password', ''))[:200]
                if not code or not new_password or len(new_password) < 6:
                    await websocket.send(json.dumps({'type': 'change_password_error', 'message': 'Invalid request.'}))
                    continue
                linked = identity_store['by_code'].get(code)
                if not linked or not linked.startswith('email:'):
                    await websocket.send(json.dumps({'type': 'change_password_error', 'message': 'Account not found.'}))
                    continue
                email = linked[len('email:'):]
                if email not in accounts:
                    await websocket.send(json.dumps({'type': 'change_password_error', 'message': 'Account not found.'}))
                    continue
                accounts[email]['password_hash'] = hashlib.sha256(new_password.encode()).hexdigest()
                save_accounts()
                await websocket.send(json.dumps({'type': 'change_password_ok'}))

            elif kind == 'delete_account':
                code      = str(data.get('code', '')).upper().strip()[:8]
                device_id = str(data.get('device_id', ''))[:64].strip()
                # Remove by code
                linked_device = identity_store['by_code'].pop(code, None)
                if linked_device:
                    identity_store['by_device'].pop(linked_device, None)
                    # If email-linked, remove from accounts too
                    if linked_device.startswith('email:'):
                        email = linked_device[len('email:'):]
                        accounts.pop(email, None)
                        save_accounts()
                # Also remove bare device_id entry if present
                if device_id:
                    identity_store['by_device'].pop(device_id, None)
                    identity_store['by_code'] = {k: v for k, v in identity_store['by_code'].items() if v != device_id}
                save_identities_file()
                await websocket.send(json.dumps({'type': 'delete_account_ok'}))

            elif kind == 'admin_get_accounts':
                ADMIN_EMAIL = 'eltonzhang0328@gmail.com'
                email    = str(data.get('email',    '')).lower().strip()[:120]
                password = str(data.get('password', ''))[:200]
                if email != ADMIN_EMAIL or email not in accounts:
                    await websocket.send(json.dumps({'type': 'admin_error', 'message': 'Access denied.'}))
                    continue
                pw_hash = hashlib.sha256(password.encode()).hexdigest()
                if accounts[email]['password_hash'] != pw_hash:
                    await websocket.send(json.dumps({'type': 'admin_error', 'message': 'Wrong password.'}))
                    continue
                user_list = [
                    {'email': e, 'name': a.get('name', ''), 'signed_up': a.get('signed_up', ''), 'code': a.get('code', '')}
                    for e, a in accounts.items()
                ]
                await websocket.send(json.dumps({'type': 'admin_accounts', 'accounts': user_list}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        chat_clients.discard(websocket)
        chat_names.pop(websocket, None)
        if websocket in clients:
            cid = clients.pop(websocket)['id']
            release_color(color)
            await broadcast_cursors({'type': 'leave', 'id': cid})

async def midnight_reset_loop():
    tz = zoneinfo.ZoneInfo('America/Los_Angeles')
    while True:
        now = datetime.datetime.now(tz)
        tomorrow = (now + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        await asyncio.sleep((tomorrow - now).total_seconds())
        chat_history.clear()
        save_chat_history()
        await broadcast_chat({'type': 'chat_reset'})
        print('Chat history cleared at midnight')

async def main():
    port = int(os.environ.get('PORT', 8080))
    host = '0.0.0.0'
    async with websockets.serve(handler, host, port, process_request=process_request):
        print(f'Cursor + chat server running on {host}:{port}')
        asyncio.ensure_future(midnight_reset_loop())
        await asyncio.Future()

asyncio.run(main())
