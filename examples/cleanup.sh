#!/bin/bash
# 删除临时辅助脚本
echo "正在删除临时辅助脚本..."
rm -f reset_account_health.js run_prettier.js

# 运行格式化脚本
echo "运行格式化脚本..."
cd ..
npm run format

echo "清理完成!"
