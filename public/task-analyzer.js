/**
 * Vibe Space - 任务输出分析器
 * 纯函数，无 DOM 依赖，可在浏览器和 Node 环境中运行
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js / CommonJS
    module.exports = factory();
  } else {
    // 浏览器全局变量
    root.TaskAnalyzer = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /** 根据任务文本推断类型：action（执行型）或 consult（咨询型） */
  function inferTaskType(text) {
    if (!text) return 'action';
    const t = text.toLowerCase();
    const consultKeywords = [
      /规划|建议|分析|思路|方案|接下来|怎么做|如何|如果.*你会|假如|评估|比较|优缺点/,
      /plan|suggest|advice|analyze|evaluate|compare|what.*should.*do|how.*should.*proceed/,
    ];
    if (consultKeywords.some(re => re.test(t))) return 'consult';
    return 'action';
  }

  /** 去除 ANSI 转义码 */
  function stripAnsiCodes(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  // 精确任务完成标记（TASK_DONE 协议）
  const TASK_DONE_SUCCESS_RE = /\[\[TASK_DONE:success\]\]\s*$/;
  const TASK_DONE_FAILED_RE  = /\[\[TASK_DONE:failed:(.+?)\]\]\s*$/s;
  const TASK_DONE_NEEDS_INPUT_RE = /\[\[TASK_DONE:needs_input:(.+?)\]\]\s*$/s;

  /** 检查 TASK_DONE 标记是否出现在文本末尾附近 */
  function hasTaskDoneMarkerNearEnd(text, markerRe) {
    return markerRe.test(text);
  }

  /** 分析 AI 输出，判断任务完成状态 */
  function analyzeTaskOutput(rawOutput, taskType = 'action') {
    const text = stripAnsiCodes(rawOutput);

    // 精确任务完成标记（TASK_DONE 协议）具有最高优先级，只在输出末尾附近检测
    const taskDoneSuccess = hasTaskDoneMarkerNearEnd(text, TASK_DONE_SUCCESS_RE);
    const taskDoneFailedMatch = hasTaskDoneMarkerNearEnd(text, TASK_DONE_FAILED_RE)
      ? text.match(TASK_DONE_FAILED_RE)
      : null;
    const taskDoneFailed = !!taskDoneFailedMatch;
    const taskDoneReason = taskDoneFailedMatch ? taskDoneFailedMatch[1].trim() : '';

    if (taskDoneSuccess) {
      return {
        doneScore: 999,
        errorScore: 0,
        questionScore: 0,
        text,
        errorContext: '',
        isDone: true,
        hasError: false,
        needsUser: false,
        isAmbiguous: false,
        needsInput: false,
      };
    }

    if (taskDoneFailed) {
      return {
        doneScore: 0,
        errorScore: 999,
        questionScore: 0,
        text,
        errorContext: taskDoneReason || 'AI 报告任务失败',
        isDone: false,
        hasError: true,
        needsUser: false,
        isAmbiguous: false,
        needsInput: false,
      };
    }

    // AI 认为需要用户决定下一步，并给出了建议的下一步
    const needsInputMatch = hasTaskDoneMarkerNearEnd(text, TASK_DONE_NEEDS_INPUT_RE)
      ? text.match(TASK_DONE_NEEDS_INPUT_RE)
      : null;
    if (needsInputMatch) {
      return {
        doneScore: 998,
        errorScore: 0,
        questionScore: 0,
        text,
        errorContext: '',
        isDone: true,
        hasError: false,
        needsUser: false,
        isAmbiguous: false,
        needsInput: true,
        nextStepSuggestion: needsInputMatch[1].trim(),
      };
    }

    // 咨询型（consult）任务：以有实质内容输出 + 无明确错误 作为完成标准
    if (taskType === 'consult') {
      const errorPatterns = [
        /error|exception|fail|failed|failure|bug|broken|crash|panic|abort/i,
        /syntax\s+error|typeerror|referenceerror|rangeerror|evalerror/i,
        /npm\s+err|yarn\s+error|pnpm\s+error|build\s+failed|test\s+failed/i,
        /失败|错误|异常|崩溃|无法.*(?:执行|完成)|不能.*(?:执行|完成)|报错|出错|未通过/i,
      ];
      const hasError = errorPatterns.some(r => r.test(text));
      const substantial = text.replace(/\s/g, '').length > 30;
      return {
        doneScore: substantial ? 1 : 0,
        errorScore: hasError ? 1 : 0,
        questionScore: 0,
        text,
        errorContext: '',
        isDone: substantial && !hasError,
        hasError,
        needsUser: false,
        isAmbiguous: false,
      };
    }

    // 完成信号（支持中英），只检测输出末尾 600 字符，避免 AI 讨论计划时误匹配
    const TAIL_LEN = 600;
    const tailText = text.slice(-TAIL_LEN);
    const donePatterns = [
      /\b(completed|done|finished|successfully|fixed|resolved|solved)\b[\s\n。！.!]*$/im,
      /(?:^|[\r\n])\s*(已完成|已修复|已解决|成功)\s*$/im,
      /(?:^|[\r\n])\s*[✓✔☑🎉👍]\s*$/im,
      /\b(i have|i've)\s+(finished|completed|done|fixed|implemented)\b/im,
      /\ball\s+(tasks|changes|tests)\s+(are\s+)?(done|complete|pass)\b/im,
    ];

    // 错误信号
    const errorPatterns = [
      /error|exception|fail|failed|failure|bug|broken|crash|panic|abort/i,
      /syntax\s+error|typeerror|referenceerror|rangeerror|evalerror/i,
      /cannot|can't|unable|won't|doesn't\s+work|not\s+working/i,
      /失败|错误|异常|崩溃|无法|不能|报错|出错|未通过/i,
      /npm\s+err|yarn\s+error|pnpm\s+error|build\s+failed|test\s+failed/i,
    ];

    // 需要用户确认的信号
    const questionPatterns = [
      /would\s+you\s+like|do\s+you\s+want|please\s+confirm|shall\s+i|should\s+i/i,
      /请确认|请选择|需要确认|需要您|需要你|可以吗|好吗/i,
      /(what|which|how|where|when|who|why)\s+.*\?/i,
      /^\s*[\w\s]{0,30}\?\s*$/m,
      /你想让我按这个方案直接执行吗/i,
      /还是你有偏好的/i,
      /是否继续/i,
      /是否执行/i,
    ];

    const doneScore = donePatterns.reduce((s, r) => s + (r.test(tailText) ? 1 : 0), 0);

    // 完成信号词：同一行内若同时出现完成词和错误词，优先视为完成描述，避免误报
    const completionWords = /\b(fixed|resolved|solved|completed|done|finished|implemented)\b|已修复|已解决|已完成|修复了|解决了/i;
    const lines = text.split(/\r?\n/);
    const errorScore = errorPatterns.reduce((s, r) => {
      const hasRealError = lines.some(line => {
        if (!r.test(line)) return false;
        // 同一行有完成词时，视为在描述已修复的问题，不计为当前错误
        if (completionWords.test(line)) return false;
        return true;
      });
      return s + (hasRealError ? 1 : 0);
    }, 0);
    const questionScore = questionPatterns.reduce((s, r) => s + (r.test(text) ? 1 : 0), 0);

    // 提取错误上下文（用于自动修复）
    let errorContext = '';
    const errIdx = lines.findIndex(l => errorPatterns.some(r => r.test(l)) && !completionWords.test(l));
    if (errIdx >= 0) {
      errorContext = lines.slice(Math.max(0, errIdx - 1), errIdx + 3).join('\n');
    }

    return {
      doneScore,
      errorScore,
      questionScore,
      text,
      errorContext,
      isDone: doneScore > 0 && errorScore === 0,
      hasError: errorScore > 0 && doneScore === 0,
      needsUser: questionScore > 0,
      isAmbiguous: (doneScore > 0 && errorScore > 0) || (doneScore === 0 && errorScore === 0 && questionScore === 0),
      needsInput: false,
    };
  }

  return {
    inferTaskType,
    stripAnsiCodes,
    hasTaskDoneMarkerNearEnd,
    TASK_DONE_SUCCESS_RE,
    TASK_DONE_FAILED_RE,
    TASK_DONE_NEEDS_INPUT_RE,
    analyzeTaskOutput,
  };
}));
