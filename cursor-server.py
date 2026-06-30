import asyncio, json, random, os, mimetypes
from pathlib import Path
import websockets
from websockets import Response
from websockets.datastructures import Headers

REPO_DIR = Path(__file__).parent

async def process_request(connection, request):
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return None  # let WebSocket upgrade proceed normally
    path = request.path.split('?')[0].lstrip('/')
    if not path:
        path = 'index.html'
    file_path = REPO_DIR / path
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
import anthropic

# 36 colors evenly spread around the hue wheel — vibrant, all distinct
COLORS = [f'hsl({h * 10}, 82%, 56%)' for h in range(36)]

clients      = {}    # websocket -> {id, name, color}
chat_clients = set() # websockets that are in the chat room
chat_history = []    # {name, text, time} — cleared daily by the server restart
MAX_HISTORY  = 500

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

async def handler(websocket):
    color = None
    try:
        async for raw in websocket:
            data = json.loads(raw)
            kind = data.get('type')

            # ── cursor events ──────────────────────────────────────────
            if kind == 'join':
                original_name = data['name']
                existing_names = {v['name'] for v in clients.values()}
                display_name = original_name
                if display_name in existing_names:
                    n = 2
                    while f'{original_name} {n}' in existing_names:
                        n += 1
                    display_name = f'{original_name} {n}'
                color = pick_color()
                info  = {'id': data['id'], 'name': display_name, 'color': color}
                clients[websocket] = info
                await websocket.send(json.dumps({'type': 'color_assign', 'color': color, 'name': display_name}))
                existing = [v for k, v in clients.items() if k is not websocket]
                if existing:
                    await websocket.send(json.dumps({'type': 'init', 'cursors': existing}))
                await broadcast_cursors({'type': 'join', **info}, exclude=websocket)

            elif kind == 'move':
                await broadcast_cursors(data, exclude=websocket)

            # ── chat events ────────────────────────────────────────────
            elif kind == 'chat_join':
                chat_clients.add(websocket)
                await websocket.send(json.dumps({'type': 'chat_history', 'messages': chat_history}))

            elif kind == 'chat':
                msg = {'name': data['name'], 'text': data['text'], 'time': data['time']}
                chat_history.append(msg)
                if len(chat_history) > MAX_HISTORY:
                    chat_history.pop(0)
                await broadcast_chat({'type': 'chat', **msg})

            elif kind == 'ask_claude':
                user_text = data.get('text', '')
                api_key = os.environ.get('ANTHROPIC_API_KEY', '')
                print(f'[ask_claude] key present: {bool(api_key)}, len: {len(api_key)}', flush=True)
                if not api_key:
                    reply = "I can't respond right now — no API key is configured."
                else:
                    try:
                        client = anthropic.Anthropic(api_key=api_key)
                        response = client.messages.create(
                            model='claude-sonnet-4-6',
                            max_tokens=512,
                            system="You are Claude, an AI assistant embedded in EFM (Elton's Fun Math), a kids' math learning website. You helped build the site. Be friendly, brief, and encouraging. If kids ask math questions, answer them clearly.",
                            messages=[{'role': 'user', 'content': user_text}]
                        )
                        reply = response.content[0].text
                    except Exception as e:
                        reply = f"Oops, something went wrong: {str(e)[:80]}"
                import datetime
                reply_msg = {'name': 'Claude', 'text': reply, 'time': datetime.datetime.utcnow().isoformat() + 'Z'}
                await websocket.send(json.dumps({'type': 'claude_reply', **reply_msg}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        chat_clients.discard(websocket)
        if websocket in clients:
            cid = clients.pop(websocket)['id']
            release_color(color)
            await broadcast_cursors({'type': 'leave', 'id': cid})

async def main():
    port = int(os.environ.get('PORT', 8080))
    host = '0.0.0.0'
    async with websockets.serve(handler, host, port, process_request=process_request):
        print(f'Cursor + chat server running on {host}:{port}')
        await asyncio.Future()

asyncio.run(main())
