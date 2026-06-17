const { describe, it } = require('node:test');
const assert = require('node:assert');

// 模拟 client.js 中的 getTaskStatus / getEffectiveTaskStatus 逻辑
function getTaskStatus(task) {
  const s = task.status;
  if (s === 'running' || s === 'executing' || s === 'testing' || s === 'review') return 'dispatched';
  if (s === 'todo') return 'idle';
  if (s === 'waiting') return 'waiting';
  if (s === 'blocked') return 'blocked';
  if (s) return s;
  if (task.done) return 'done';
  return 'idle';
}

function getEffectiveTaskStatus(task, allTasks) {
  const base = getTaskStatus(task);
  if (base === 'done') return 'done';
  if (!allTasks || !task.blockedBy || !Array.isArray(task.blockedBy) || task.blockedBy.length === 0) return base;
  const blocked = task.blockedBy.some(depIdx => {
    const dep = allTasks[depIdx];
    if (!dep) return true;
    return getEffectiveTaskStatus(dep, allTasks) !== 'done';
  });
  return blocked ? 'blocked' : base;
}

describe('getEffectiveTaskStatus', () => {
  it('无依赖返回原状态', () => {
    const tasks = [{ status: 'idle' }, { status: 'done', done: true }];
    assert.strictEqual(getEffectiveTaskStatus(tasks[0], tasks), 'idle');
    assert.strictEqual(getEffectiveTaskStatus(tasks[1], tasks), 'done');
  });

  it('依赖未完成时状态为 blocked', () => {
    const tasks = [
      { status: 'idle' },
      { status: 'idle', blockedBy: [0] },
    ];
    assert.strictEqual(getEffectiveTaskStatus(tasks[1], tasks), 'blocked');
  });

  it('依赖完成后状态为原状态', () => {
    const tasks = [
      { status: 'done', done: true },
      { status: 'idle', blockedBy: [0] },
    ];
    assert.strictEqual(getEffectiveTaskStatus(tasks[1], tasks), 'idle');
  });

  it('支持多级依赖', () => {
    const tasks = [
      { status: 'done', done: true },
      { status: 'done', done: true, blockedBy: [0] },
      { status: 'idle', blockedBy: [1] },
    ];
    assert.strictEqual(getEffectiveTaskStatus(tasks[2], tasks), 'idle');
  });

  it('依赖缺失视为阻塞', () => {
    const tasks = [{ status: 'idle', blockedBy: [5] }];
    assert.strictEqual(getEffectiveTaskStatus(tasks[0], tasks), 'blocked');
  });
});
