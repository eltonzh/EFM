import asyncio, json, random, os
import websockets

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
                color = pick_color()
                info  = {'id': data['id'], 'name': data['name'], 'color': color}
                clients[websocket] = info
                await websocket.send(json.dumps({'type': 'color_assign', 'color': color}))
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

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        chat_clients.discard(websocket)
        if websocket in clients:
            cid = clients.pop(websocket)['id']
            release_color(color)
            await broadcast_cursors({'type': 'leave', 'id': cid})

async def main():
    port = int(os.environ.get('PORT', 8081))
    host = '0.0.0.0'
    async with websockets.serve(handler, host, port):
        print(f'Cursor + chat server running on {host}:{port}')
        await asyncio.Future()

asyncio.run(main())
