#!/bin/zsh
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
python3 - "$PWD" <<'PY'
import fcntl, json, os, pathlib, signal, subprocess, sys, time
root = pathlib.Path(sys.argv[1]).resolve()
data = root / 'data'
if not data.is_dir():
    raise SystemExit('EOPS尚未运行。')
lock = (data / 'service.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX)
pid_file = data / 'server.pid.json'
if not pid_file.exists():
    raise SystemExit('没有EOPS的启动记录，无需停止。')
try:
    saved = json.loads(pid_file.read_text())
    pid = saved['pid']
    if type(pid) is not int or pid <= 1:
        raise ValueError('invalid process id')
    identity = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'lstart=', '-o', 'command='], text=True, capture_output=True, env={**os.environ, 'LC_ALL': 'en_US.UTF-8', 'TZ': 'UTC'}).stdout.strip()
    if not identity:
        pid_file.unlink()
        raise SystemExit('EOPS已经停止。')
    pieces = identity.split(None, 5)
    server_path = str(root / 'server/server.py')
    stable_identity = ' '.join(pieces[:5]) + '|' + server_path if len(pieces) == 6 and pieces[5].endswith(' ' + server_path) else ''
    if not stable_identity or stable_identity != saved['identity']:
        raise SystemExit('进程身份不匹配，未停止任何进程。请检查 data/server.pid.json。')
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        status = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'stat='], text=True, capture_output=True).stdout.strip()
        if not status or status.startswith('Z'):
            pid_file.unlink(missing_ok=True)
            print('EOPS已停止，数据保留在 data/dayline.sqlite3。')
            break
        time.sleep(0.1)
    else:
        raise SystemExit('服务正在结束当前请求，请稍后再试。')
except (ValueError, KeyError, TypeError):
    raise SystemExit('启动记录无效，未停止任何进程。')
PY
