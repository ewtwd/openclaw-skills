#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

/**
 * 微博发布任务管理器
 * 专门针对飞书机器人发送微博任务时的场景优化
 * 特点：任务串行执行，文案和素材分开发送，素材在飞书上传
 */

class WeiboTaskManager {
  constructor() {
    this.tasksDir = path.join(process.cwd(), 'tasks');
    this.ensureTasksDirExists();
    // 当前正在处理的任务ID，用于串行执行
    this.currentTaskId = null;
  }

  /**
   * 确保任务存储目录存在
   */
  ensureTasksDirExists() {
    if (!fs.existsSync(this.tasksDir)) {
      fs.mkdirSync(this.tasksDir, { recursive: true });
    }
  }

  /**
   * 创建新任务（适用于飞书场景）
   * 每次新任务都会替换当前正在处理的任务
   * @param {string} initialText 初始文案（可选）
   * @returns {string} 任务ID
   */
  createTask(initialText = null) {
    // 清理之前的任务（如果有）
    if (this.currentTaskId) {
      this.deleteTask(this.currentTaskId);
    }
    
    const id = Date.now().toString();
    const taskPath = path.join(this.tasksDir, `${id}.json`);
    
    const taskData = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'created', // created, pending, complete, failed
      data: initialText ? { text: initialText } : {}
    };
    
    fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));
    this.currentTaskId = id;
    
    console.log(`新任务创建成功: ${id}`);
    if (initialText) {
      console.log(`任务文案: ${initialText}`);
    }
    
    return id;
  }

  /**
   * 保存任务数据（适用于飞书场景）
   * 支持追加模式，自动关联到当前任务
   * @param {object} data 任务数据（文案、图片路径、视频路径等）
   * @returns {boolean} 是否保存成功
   */
  saveTaskData(data) {
    if (!this.currentTaskId) {
      console.error('没有正在处理的任务，请先发送文案');
      return false;
    }
    
    const taskPath = path.join(this.tasksDir, `${this.currentTaskId}.json`);
    
    if (!fs.existsSync(taskPath)) {
      console.error(`当前任务不存在: ${this.currentTaskId}`);
      return false;
    }
    
    const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    taskData.data = { ...taskData.data, ...data };
    taskData.updatedAt = new Date().toISOString();
    
    // 根据数据完整性设置状态
    if (taskData.data.text) {
      taskData.status = 'pending';
    }
    
    fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));
    console.log(`任务数据更新成功: ${this.currentTaskId}`);
    
    return true;
  }

  /**
   * 发送任务数据（飞书场景专用）
   * 自动判断是创建新任务还是更新当前任务
   * @param {string} text 文案
   * @param {string} media 媒体路径（图片或视频）
   * @param {string} mediaType 媒体类型（image/video）
   * @returns {boolean} 是否成功
   */
  sendTask(text = null, media = null, mediaType = null) {
    // 如果有文案，创建新任务或更新当前任务的文案
    if (text) {
      if (this.currentTaskId) {
        // 如果有正在处理的任务，先完成它
        console.log('当前任务未完成，先创建新任务');
      }
      // 创建新任务
      this.createTask(text);
    }
    
    // 如果有媒体文件，更新当前任务的媒体信息
    if (media && mediaType) {
      if (!this.currentTaskId) {
        console.error('请先发送文案，然后再发送媒体文件');
        return false;
      }
      
      const mediaKey = mediaType === 'image' ? 'images' : 'video';
      const taskPath = path.join(this.tasksDir, `${this.currentTaskId}.json`);
      const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
      
      if (mediaType === 'image') {
        if (!taskData.data.images) {
          taskData.data.images = [];
        }
        taskData.data.images.push(media);
      } else {
        taskData.data.video = media;
      }
      
      taskData.updatedAt = new Date().toISOString();
      taskData.status = 'pending'; // 任务已完整，可以执行
      fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));
      
      console.log(`媒体文件 ${mediaType} 已添加到任务: ${this.currentTaskId}`);
    }
    
    return true;
  }

  /**
   * 获取当前任务数据
   * @returns {object} 任务数据
   */
  getCurrentTaskData() {
    if (!this.currentTaskId) {
      console.error('没有正在处理的任务');
      return null;
    }
    
    const taskPath = path.join(this.tasksDir, `${this.currentTaskId}.json`);
    
    if (!fs.existsSync(taskPath)) {
      console.error(`当前任务不存在: ${this.currentTaskId}`);
      this.currentTaskId = null;
      return null;
    }
    
    return JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  }

  /**
   * 执行当前任务
   * @param {Function} executor 任务执行函数
   * @returns {Promise} 执行结果
   */
  async executeCurrentTask(executor) {
    if (!this.currentTaskId) {
      console.error('没有正在处理的任务');
      return null;
    }
    
    const taskData = this.getCurrentTaskData();
    if (!taskData) {
      return null;
    }
    
    // 检查任务数据完整性
    if (!taskData.data.text) {
      console.error('任务数据不完整：缺少文案');
      return null;
    }
    
    try {
      console.log(`开始执行任务: ${this.currentTaskId}`);
      taskData.status = 'executing';
      this.saveTaskData({ status: 'executing' });
      
      const result = await executor(taskData.data);
      
      // 任务执行成功
      taskData.status = 'complete';
      this.saveTaskData({ status: 'complete' });
      
      console.log(`任务执行成功: ${this.currentTaskId}`);
      
      // 重置当前任务ID，准备接收下一个任务
      this.currentTaskId = null;
      
      return result;
    } catch (error) {
      // 任务执行失败
      taskData.status = 'failed';
      this.saveTaskData({ status: 'failed', error: error.message });
      
      console.error(`任务执行失败: ${this.currentTaskId}`);
      console.error(error);
      
      // 重置当前任务ID，准备接收下一个任务
      this.currentTaskId = null;
      
      return null;
    }
  }

  /**
   * 完成当前任务（用于任务执行成功后）
   * @returns {boolean} 是否成功
   */
  completeCurrentTask() {
    if (!this.currentTaskId) {
      console.error('没有正在处理的任务');
      return false;
    }
    
    const taskPath = path.join(this.tasksDir, `${this.currentTaskId}.json`);
    const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    taskData.status = 'complete';
    fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));
    
    console.log(`任务完成: ${this.currentTaskId}`);
    this.currentTaskId = null;
    
    return true;
  }

  /**
   * 失败当前任务（用于任务执行失败后）
   * @param {string} error 错误信息
   * @returns {boolean} 是否成功
   */
  failCurrentTask(error) {
    if (!this.currentTaskId) {
      console.error('没有正在处理的任务');
      return false;
    }
    
    const taskPath = path.join(this.tasksDir, `${this.currentTaskId}.json`);
    const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    taskData.status = 'failed';
    taskData.error = error;
    fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));
    
    console.error(`任务失败: ${this.currentTaskId}`);
    this.currentTaskId = null;
    
    return true;
  }

  /**
   * 获取任务数据
   * @param {string} taskId 任务ID
   * @returns {object} 任务数据
   */
  getTaskData(taskId) {
    const taskPath = path.join(this.tasksDir, `${taskId}.json`);
    
    if (!fs.existsSync(taskPath)) {
      console.error(`任务不存在: ${taskId}`);
      return null;
    }
    
    return JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  }

  /**
   * 删除任务
   * @param {string} taskId 任务ID
   * @returns {boolean} 是否删除成功
   */
  deleteTask(taskId) {
    const taskPath = path.join(this.tasksDir, `${taskId}.json`);
    
    if (!fs.existsSync(taskPath)) {
      console.error(`任务不存在: ${taskId}`);
      return false;
    }
    
    fs.unlinkSync(taskPath);
    console.log(`任务删除成功: ${taskId}`);
    
    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }
    
    return true;
  }

  /**
   * 列出所有任务
   * @returns {Array} 任务列表
   */
  listTasks() {
    const tasks = [];
    
    if (fs.existsSync(this.tasksDir)) {
      const files = fs.readdirSync(this.tasksDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const taskPath = path.join(this.tasksDir, file);
          tasks.push(JSON.parse(fs.readFileSync(taskPath, 'utf8')));
        }
      });
    }
    
    return tasks;
  }

  /**
   * 清理过期任务（超过24小时的任务）
   * @returns {number} 清理的任务数量
   */
  cleanExpiredTasks() {
    const now = Date.now();
    const expiredThreshold = 24 * 60 * 60 * 1000; // 24小时
    let cleanedCount = 0;
    
    if (fs.existsSync(this.tasksDir)) {
      const files = fs.readdirSync(this.tasksDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const taskPath = path.join(this.tasksDir, file);
          const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
          const taskTime = new Date(taskData.createdAt).getTime();
          
          if (now - taskTime > expiredThreshold) {
            fs.unlinkSync(taskPath);
            cleanedCount++;
          }
        }
      });
    }
    
    console.log(`清理了 ${cleanedCount} 个过期任务`);
    return cleanedCount;
  }
}

// 导出任务管理器
export { WeiboTaskManager };

// 如果直接运行此脚本，提供简单的命令行接口
if (import.meta.url === `file://${process.argv[1]}`) {
  const taskManager = new WeiboTaskManager();
  
  // 解析命令行参数
  const [, , command, ...args] = process.argv;
  
  switch (command) {
    case 'send-task':
      // 发送任务（支持文案或素材）
      if (args.length === 0) {
        console.error('Usage: node task-manager.mjs send-task --text <文案> | --image <图片路径> | --video <视频路径>');
        process.exit(1);
      }
      
      const options = {};
      let i = 0;
      while (i < args.length) {
        const arg = args[i];
        if (arg === '--text' && i + 1 < args.length) {
          options.text = args[i + 1];
          i += 2;
        } else if (arg === '--image' && i + 1 < args.length) {
          options.image = args[i + 1];
          i += 2;
        } else if (arg === '--video' && i + 1 < args.length) {
          options.video = args[i + 1];
          i += 2;
        } else {
          i++;
        }
      }
      
      if (options.text) {
        taskManager.sendTask(options.text);
      } else if (options.image) {
        taskManager.sendTask(null, options.image, 'image');
      } else if (options.video) {
        taskManager.sendTask(null, options.video, 'video');
      } else {
        console.error('至少需要提供文案或素材');
      }
      break;
      
    case 'execute':
      // 执行当前任务
      if (args.length > 0 && args[0] === '--dry-run') {
        const taskData = taskManager.getCurrentTaskData();
        if (taskData) {
          console.log('当前任务数据:');
          console.log(JSON.stringify(taskData, null, 2));
        }
      } else {
        // 这里应该调用 social-publisher 的执行函数
        console.log('需要与 social-publisher 集成才能执行任务');
      }
      break;
      
    case 'list':
      const tasks = taskManager.listTasks();
      console.log(JSON.stringify(tasks, null, 2));
      break;
      
    case 'current':
      const currentTask = taskManager.getCurrentTaskData();
      if (currentTask) {
        console.log('当前任务:');
        console.log(JSON.stringify(currentTask, null, 2));
      }
      break;
      
    case 'clean':
      taskManager.cleanExpiredTasks();
      break;
      
    default:
      console.log(`
飞书场景任务管理器命令:
  send-task --text <文案>      发送文案，创建新任务
  send-task --image <路径>     添加图片到当前任务
  send-task --video <路径>     添加视频到当前任务
  execute                      执行当前任务（需要集成）
  execute --dry-run            模拟执行，显示任务数据
  list                         列出所有任务
  current                      显示当前任务
  clean                        清理过期任务（超过24小时）
      `);
  }
}
