import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = fileURLToPath(new URL('../scripts/mcp-server.mjs', import.meta.url));
const project = { id: 'project-test', title: 'MCP test only', description: '', startDate: '2026-10-19', endDate: '2026-10-30', status: 'active', order: 0, members: ['自己'] };
const state = { schemaVersion: 1, revision: 1, projects: [project], tasks: [], milestones: [], requirements: [], batches: [], settings: {} };
let writes = 0;
let stub;
let base = process.env.EOPS_TEST_URL || process.env.DAYLINE_TEST_URL;

if (!base) {
  stub = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/state') return response.end(JSON.stringify(state));
    if (request.method === 'POST' && request.url === '/api/action') {
      assert.equal(request.headers['content-type'], 'application/json');
      assert.equal(request.headers.origin, undefined);
      let raw = '';
      for await (const part of request) raw += part;
      const action = JSON.parse(raw);
      if (action.expectedRevision !== state.revision) { response.statusCode = 409; return response.end(JSON.stringify({ error: 'revision conflict' })); }
      writes++;
      assert.equal(action.type, 'task.create');
      state.tasks.push({ id: `task-${writes}`, ...action.payload, done: false, order: writes - 1 });
      state.revision++;
      return response.end(JSON.stringify(state));
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${stub.address().port}`;
}

const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { EOPS_URL: base }, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', data => { stderr += data.toString(); });
const client = new Client({ name: 'eops-smoke', version: '0.2.0' });
const unpack = response => {
  assert.equal(response.isError, undefined, JSON.stringify(response.content));
  return JSON.parse(response.content.find(item => item.type === 'text').text);
};

try {
  await client.connect(transport);
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(tool => tool.name).sort(), ['eops_apply_action', 'eops_get_day', 'eops_get_state', 'eops_list_projects']);
  const current = unpack(await client.callTool({ name: 'eops_get_state', arguments: {} }));
  assert.ok(Number.isInteger(current.revision));
  assert.ok(Array.isArray(current.projects));
  unpack(await client.callTool({ name: 'eops_list_projects', arguments: {} }));
  const day = unpack(await client.callTool({ name: 'eops_get_day', arguments: { date: '2026-10-22' } }));
  assert.equal(day.date, '2026-10-22');
  assert.equal(day.completion.total, day.tasks.length);

  if (stub) {
    assert.equal(day.completion.noTasks, true);
    const created = unpack(await client.callTool({ name: 'eops_apply_action', arguments: { expectedRevision: 1, action: { type: 'task.create', payload: { projectId: project.id, title: '仅测试条目', date: '2026-10-22' } } } }));
    assert.equal(created.revision, 2);
    assert.equal(writes, 1);
    const changedDay = unpack(await client.callTool({ name: 'eops_get_day', arguments: { date: '2026-10-22', projectId: project.id } }));
    assert.equal(changedDay.tasks[0].title, '仅测试条目');
    assert.equal(changedDay.completion.percent, 0);

    const conflict = await client.callTool({ name: 'eops_apply_action', arguments: { expectedRevision: 1, action: { type: 'task.create', payload: { projectId: project.id, title: '过期版本' } } } });
    assert.equal(conflict.isError, true);
    assert.match(conflict.content[0].text, /409/);
    assert.equal(writes, 1);

    for (const args of [
      { action: { type: 'task.create', payload: { projectId: project.id, title: '缺少版本' } } },
      { expectedRevision: 2, action: { type: 'project.delete', payload: { id: project.id } } },
      { expectedRevision: 2, action: { type: 'task.create', payload: { projectId: project.id, title: '非法日期', date: '2026-02-30' } } },
      { expectedRevision: 2, action: { type: 'task.create', payload: { projectId: project.id, title: '额外属性', untrusted: true } } },
    ]) {
      const rejected = await client.callTool({ name: 'eops_apply_action', arguments: args });
      assert.equal(rejected.isError, true);
    }
    assert.equal(writes, 1);
  }
  assert.equal(stderr, '');
  console.log(stub ? 'PASS: MCP handshake, tools, day/state reads, validated API write, stale revision and invalid input rejection (isolated HTTP fixture).' : 'PASS: MCP handshake, tools and live EOPS read operations; no live records changed.');
} finally {
  await client.close();
  if (stub) await new Promise(resolve => stub.close(resolve));
}

for (const badUrl of ['https://example.com', 'http://192.168.1.2:11325', 'http://127.0.0.1:11325/private', 'http://user:password@127.0.0.1:11325']) {
  const child = spawnSync(process.execPath, [serverPath], { env: { ...process.env, EOPS_URL: badUrl }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /回环/);
  assert.equal(child.stdout, '');
}
console.log('PASS: external/non-root/credential URLs rejected before connection.');
