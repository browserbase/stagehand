import fs from 'fs';
import path from 'path';

// 直接在本文件中定义ReplyContent接口，而不是导入
interface ReplyContent {
  text?: string;
  image?: string;
  video?: string;
  accountUsername?: string;
}

interface SmartResponse {
  pattern: string;
  responses: string[];
  mediaUrls: string[];
}

export class SmartReplySelector {
  private responses: SmartResponse[] = [];
  private defaultReplies: ReplyContent[] = [];
  private regexCache: Map<string, RegExp> = new Map();

  /**
   * 初始化智能回复选择器
   * @param responsesPath 智能回复配置文件路径
   * @param defaultRepliesPath 默认回复配置文件路径
   */
  constructor(responsesPath: string, defaultRepliesPath: string) {
    try {
      // 加载智能回复配置
      if (fs.existsSync(responsesPath)) {
        this.responses = JSON.parse(fs.readFileSync(responsesPath, 'utf-8'));
        
        // 预编译所有正则表达式以提高性能
        this.responses.forEach(response => {
          this.regexCache.set(response.pattern, new RegExp(response.pattern, 'i'));
        });
      }
      
      // 加载默认回复配置
      if (fs.existsSync(defaultRepliesPath)) {
        this.defaultReplies = JSON.parse(fs.readFileSync(defaultRepliesPath, 'utf-8'));
      }
    } catch (error) {
      console.error('初始化智能回复选择器失败:', error);
      // 如果加载失败，创建空数组以允许系统继续运行
      this.responses = [];
      this.defaultReplies = [];
    }
  }

  /**
   * 根据推文内容选择合适的回复
   * @param tweetText 推文文本内容
   * @param preferredAccount 首选账号（可选）
   * @returns 选择的回复内容
   */
  selectReply(tweetText: string, preferredAccount?: string): ReplyContent {
    // 如果没有配置智能回复或默认回复，返回基本回复
    if (this.responses.length === 0 && this.defaultReplies.length === 0) {
      return {
        text: '感谢分享您的想法！',
        image: '',
        video: '',
        accountUsername: preferredAccount || ''
      };
    }

    // 匹配推文内容与智能回复模式
    for (const response of this.responses) {
      const regex = this.regexCache.get(response.pattern);
      if (regex && regex.test(tweetText)) {
        // 随机选择一个匹配的回复
        const randomResponse = response.responses[Math.floor(Math.random() * response.responses.length)];
        
        // 构建回复内容对象
        const replyContent: ReplyContent = {
          text: randomResponse,
          image: '',
          video: '',
          accountUsername: preferredAccount || ''
        };
        
        // 如果有媒体，随机选择一个
        if (response.mediaUrls && response.mediaUrls.length > 0) {
          const mediaUrl = response.mediaUrls[Math.floor(Math.random() * response.mediaUrls.length)];
          
          // 根据文件扩展名判断是图片还是视频
          const ext = path.extname(mediaUrl).toLowerCase();
          if (['.mp4', '.mov', '.avi', '.wmv', '.flv'].includes(ext)) {
            replyContent.video = mediaUrl;
          } else {
            replyContent.image = mediaUrl;
          }
        }
        
        return replyContent;
      }
    }
    
    // 如果没有匹配的智能回复，随机选择一个默认回复
    if (this.defaultReplies.length > 0) {
      const defaultReply = this.defaultReplies[Math.floor(Math.random() * this.defaultReplies.length)];
      
      // 如果指定了首选账号，使用该账号
      if (preferredAccount) {
        return {
          ...defaultReply,
          accountUsername: preferredAccount
        };
      }
      
      return defaultReply;
    }
    
    // 最后的备选方案
    return {
      text: '感谢分享您的想法！',
      image: '',
      video: '',
      accountUsername: preferredAccount || ''
    };
  }
  
  /**
   * 计算推文与回复模式的相关性分数
   * 可用于未来扩展，实现更复杂的匹配逻辑
   * @param tweetText 推文文本
   * @param pattern 匹配模式
   * @returns 相关性分数（0-1）
   */
  private calculateRelevanceScore(tweetText: string, pattern: string): number {
    const patternTerms = pattern.split('|');
    let matches = 0;
    
    for (const term of patternTerms) {
      const regex = new RegExp(term.trim(), 'i');
      if (regex.test(tweetText)) {
        matches++;
      }
    }
    
    return matches / patternTerms.length;
  }
} 