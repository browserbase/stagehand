import path from 'path';
import { SmartReplySelector } from './smartReplySelector';

// 示例函数：测试智能回复选择器
async function testSmartReplySelector() {
  console.log('开始测试智能回复选择器...');
  
  // 初始化选择器
  const responsesPath = path.join(process.cwd(), 'examples', 'config', 'responses.json');
  const repliesPath = path.join(process.cwd(), 'examples', 'config', 'replies.json');
  const selector = new SmartReplySelector(responsesPath, repliesPath);
  
  // 测试不同类型的推文内容
  const testTweets = [
    { id: '1', content: '人工智能正在改变我们的生活方式，今天我体验了最新的AI助手，非常惊艳！' },
    { id: '2', content: '比特币今天又创新高，加密货币市场正在复苏。' },
    { id: '3', content: '我们刚刚完成了新一轮融资，这是我创业以来最艰难也最有成就感的时刻。' },
    { id: '4', content: '今天的晚霞太美了，分享给大家！这是我在旅行中拍到的最美景色。' },
  ];
  
  // 对每条测试推文选择回复
  console.log('\n=== 智能回复测试结果 ===\n');
  for (const tweet of testTweets) {
    console.log(`原推文 (ID: ${tweet.id}): "${tweet.content}"`);
    
    // 为每条推文选择回复
    const reply = selector.selectReply(tweet.content);
    
    console.log(`选择的回复: "${reply.text}"`);
    if (reply.image) console.log(`附带图片: ${reply.image}`);
    if (reply.video) console.log(`附带视频: ${reply.video}`);
    if (reply.accountUsername) console.log(`使用账号: ${reply.accountUsername}`);
    
    console.log('-------------------');
  }
  
  // 测试指定账号
  console.log('\n=== 指定账号回复测试 ===\n');
  const specifiedAccount = 'your_twitter_username1';
  const reply = selector.selectReply(testTweets[0].content, specifiedAccount);
  console.log(`原推文: "${testTweets[0].content}"`);
  console.log(`指定账号 ${specifiedAccount} 的回复: "${reply.text}"`);
  console.log(`账号: ${reply.accountUsername}`);
  
  console.log('\n测试完成！');
}

// 执行测试
testSmartReplySelector().catch(error => {
  console.error('测试过程中发生错误:', error);
  process.exit(1);
}); 