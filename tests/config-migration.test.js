const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 从 server.js 提取迁移函数（避免启动服务器）
function migrateInlineAttachments(config) {
  let migrated = false;
  if (!config.projects) return migrated;

  config.projects.forEach((proj, projectIndex) => {
    if (!proj.tasks) return;
    proj.tasks.forEach((task, taskIndex) => {
      if (!task.attachments || task.attachments.length === 0) return;

      const baseDir = path.join(proj.cwd, '.vibe-space', 'attachments', `${projectIndex}-${taskIndex}`);
      fs.mkdirSync(baseDir, { recursive: true });

      task.attachments = task.attachments.map((att, idx) => {
        if (att.kind === 'text' || att.isVirtualText || att.path) return att;

        const raw = att.data || att.content || '';
        const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
        if (!base64) return att;

        if (att.saved && att.path) {
          const { data, content, ...meta } = att;
          migrated = true;
          return { ...meta };
        }

        try {
          const ext = path.extname(att.name) || (att.kind === 'image' ? '.png' : '.bin');
          const baseName = path.basename(att.name || `attachment_${idx}`, ext);
          const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileName = `${Date.now()}_${safeName}${ext}`;
          const filePath = path.join(baseDir, fileName);
          fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

          const { data, content, ...meta } = att;
          migrated = true;
          return { ...meta, path: filePath, saved: true };
        } catch (e) {
          return att;
        }
      });
    });
  });

  return migrated;
}

describe('migrateInlineAttachments', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-test-'));

  it('将 base64 图片附件迁移到本地文件', () => {
    const imgBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const config = {
      projects: [{
        name: 'test',
        cwd: tmpDir,
        tasks: [{
          text: 'task with image',
          attachments: [{
            name: 'test.png',
            kind: 'image',
            data: `data:image/png;base64,${imgBase64}`,
          }],
        }],
      }],
    };

    const result = migrateInlineAttachments(config);
    assert.strictEqual(result, true);

    const att = config.projects[0].tasks[0].attachments[0];
    assert.strictEqual(att.path.startsWith(path.join(tmpDir, '.vibe-space', 'attachments', '0-0')), true);
    assert.strictEqual(fs.existsSync(att.path), true);
    assert.strictEqual(att.data, undefined);
  });

  it('文本附件保留原样', () => {
    const config = {
      projects: [{
        name: 'test',
        cwd: tmpDir,
        tasks: [{
          text: 'task with text',
          attachments: [{
            name: 'log.txt',
            kind: 'text',
            content: 'some log',
          }],
        }],
      }],
    };

    migrateInlineAttachments(config);
    const att = config.projects[0].tasks[0].attachments[0];
    assert.strictEqual(att.content, 'some log');
    assert.strictEqual(att.path, undefined);
  });
});
