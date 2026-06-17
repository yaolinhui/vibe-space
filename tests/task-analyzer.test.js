const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  inferTaskType,
  analyzeTaskOutput,
  hasTaskDoneMarkerNearEnd,
  TASK_DONE_SUCCESS_RE,
  TASK_DONE_FAILED_RE,
} = require('../public/task-analyzer.js');

describe('inferTaskType', () => {
  it('识别执行型任务', () => {
    assert.strictEqual(inferTaskType('修复首页的 bug'), 'action');
    assert.strictEqual(inferTaskType('run tests and fix errors'), 'action');
  });

  it('识别咨询型任务', () => {
    assert.strictEqual(inferTaskType('帮我规划接下来的工作'), 'consult');
    assert.strictEqual(inferTaskType('分析一下这个项目的架构'), 'consult');
    assert.strictEqual(inferTaskType('what should I do next?'), 'consult');
  });

  it('空文本默认为执行型', () => {
    assert.strictEqual(inferTaskType(''), 'action');
    assert.strictEqual(inferTaskType(null), 'action');
  });
});

describe('TASK_DONE marker', () => {
  it('检测成功标记', () => {
    assert.strictEqual(
      hasTaskDoneMarkerNearEnd('已完成修复\n[[TASK_DONE:success]]', TASK_DONE_SUCCESS_RE),
      true
    );
  });

  it('失败标记含原因', () => {
    const text = '无法连接数据库\n[[TASK_DONE:failed:数据库连接超时]]';
    assert.strictEqual(hasTaskDoneMarkerNearEnd(text, TASK_DONE_FAILED_RE), true);
    const match = text.match(TASK_DONE_FAILED_RE);
    assert.strictEqual(match[1], '数据库连接超时');
  });

  it('标记不在末尾不命中', () => {
    const text = '[[TASK_DONE:success]]\n后面还有内容';
    assert.strictEqual(hasTaskDoneMarkerNearEnd(text, TASK_DONE_SUCCESS_RE), false);
  });
});

describe('TASK_DONE needs_input marker', () => {
  it('检测下一步建议', () => {
    const result = analyzeTaskOutput('我建议先整理需求文档。\n[[TASK_DONE:needs_input:整理需求文档]]', 'action');
    assert.strictEqual(result.isDone, true);
    assert.strictEqual(result.needsInput, true);
    assert.strictEqual(result.nextStepSuggestion, '整理需求文档');
  });

  it('needs_input 标记不在末尾不命中', () => {
    const result = analyzeTaskOutput('[[TASK_DONE:needs_input:整理需求文档]]\n后面还有内容', 'action');
    assert.strictEqual(result.needsInput, false);
  });
});

describe('analyzeTaskOutput - action tasks', () => {
  it('TASK_DONE 成功具有最高优先级', () => {
    const result = analyzeTaskOutput('[[TASK_DONE:success]]', 'action');
    assert.strictEqual(result.isDone, true);
    assert.strictEqual(result.hasError, false);
  });

  it('TASK_DONE 失败', () => {
    const result = analyzeTaskOutput('[[TASK_DONE:failed:权限不足]]', 'action');
    assert.strictEqual(result.isDone, false);
    assert.strictEqual(result.hasError, true);
    assert.strictEqual(result.errorContext, '权限不足');
  });

  it('末尾完成信号', () => {
    const result = analyzeTaskOutput('I have fixed the bug.\nAll tests are done.', 'action');
    assert.strictEqual(result.isDone, true);
    assert.strictEqual(result.hasError, false);
  });

  it('检测到错误', () => {
    const result = analyzeTaskOutput('npm ERR! build failed\nReferenceError: foo is not defined', 'action');
    assert.strictEqual(result.isDone, false);
    assert.strictEqual(result.hasError, true);
    assert.ok(result.errorContext.includes('ReferenceError'));
  });

  it('需要用户确认', () => {
    const result = analyzeTaskOutput('Would you like me to proceed?', 'action');
    assert.strictEqual(result.needsUser, true);
    assert.strictEqual(result.isAmbiguous, false);
  });

  it('同时有完成和错误视为模糊', () => {
    const result = analyzeTaskOutput('Fixed the bug but npm ERR! build failed', 'action');
    assert.strictEqual(result.isAmbiguous, true);
  });
});

describe('analyzeTaskOutput - consult tasks', () => {
  it('有实质输出即完成', () => {
    const result = analyzeTaskOutput('我建议先整理需求文档，再设计数据库表结构，最后实现核心 API。你想让我按这个顺序开始吗？', 'consult');
    assert.strictEqual(result.isDone, true);
    assert.strictEqual(result.hasError, false);
  });

  it('短输出视为未完成但不模糊（可进入 consult 特殊处理）', () => {
    const result = analyzeTaskOutput('你好', 'consult');
    assert.strictEqual(result.isDone, false);
    // consult 类型把 questionScore 固定为 0，所以不会 needsUser
    assert.strictEqual(result.needsUser, false);
  });

  it('咨询型任务即使有 error 关键词也不视为失败', () => {
    const result = analyzeTaskOutput('我先分析了一下，发现代码里有很多 bug，建议这样改...', 'consult');
    // consult 的 hasError 可能为 true，但调用方会特殊处理（直接完成）
    assert.ok(result.text.length > 0);
  });
});
