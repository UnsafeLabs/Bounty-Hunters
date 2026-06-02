#!/usr/bin/env python3
"""
批量提交 Bounty PR 脚本
自动搜索 open issues，编写修复代码，提交 PR
"""

import subprocess
import json
import os
from datetime import datetime

# 已提交的 PR 列表
SUBMITTED_FILE = os.path.expanduser("~/Bounty-Hunters-919/submitted-prs.json")

def load_submitted():
    """加载已提交的 PR 列表"""
    try:
        with open(SUBMITTED_FILE, 'r') as f:
            return json.load(f)
    except:
        return {
            "unsafe_labs": [],
            "finmind": [],
            "clanker_nation": [],
            "secure_banana": [],
            "claude_builders": [],
            "elizaos": [],
            "total": 0,
            "last_updated": datetime.now().isoformat()
        }

def save_submitted(data):
    """保存已提交的 PR 列表"""
    data["last_updated"] = datetime.now().isoformat()
    with open(SUBMITTED_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def get_open_issues(repo, limit=20):
    """获取 open issues"""
    try:
        result = subprocess.run(
            ["gh", "issue", "list", "--repo", repo, "--state", "open", "--limit", str(limit), "--json", "number,title,labels"],
            capture_output=True, text=True, check=True
        )
        return json.loads(result.stdout)
    except:
        return []

def submit_pr(repo, issue_number, title, body, files):
    """提交 PR"""
    try:
        # 创建分支
        branch_name = f"fix/{title.lower().replace(' ', '-')[:50]}"
        subprocess.run(["git", "checkout", "-b", branch_name], check=True)
        
        # 添加文件
        for file_path in files:
            subprocess.run(["git", "add", file_path], check=True)
        
        # 提交
        subprocess.run(["git", "commit", "-m", f"Fix #{issue_number}: {title}"], check=True)
        
        # 推送
        subprocess.run(["git", "push", "origin", branch_name], check=True)
        
        # 创建 PR
        pr_body = f"Closes #{issue_number}\n\n{body}"
        result = subprocess.run(
            ["gh", "pr", "create", "--repo", repo, "--title", f"Fix #{issue_number}: {title}", "--body", pr_body],
            capture_output=True, text=True, check=True
        )
        
        return result.stdout.strip()
    except Exception as e:
        print(f"Error submitting PR: {e}")
        return None

def main():
    """主函数"""
    print("🚀 开始批量提交 Bounty PR")
    print("=" * 50)
    
    # 加载已提交列表
    submitted = load_submitted()
    print(f"📊 已提交: {submitted['total']} 个 PR")
    
    # 获取 open issues
    repos = [
        ("UnsafeLabs/Bounty-Hunters", "unsafe_labs"),
        ("rohitdash08/FinMind", "finmind"),
    ]
    
    total_new = 0
    
    for repo, key in repos:
        print(f"\n📦 处理仓库: {repo}")
        issues = get_open_issues(repo, limit=10)
        
        for issue in issues:
            issue_num = issue["number"]
            
            # 跳过已提交的
            if issue_num in submitted.get(key, []):
                print(f"  ⏭️ 跳过 #{issue_num} (已提交)")
                continue
            
            print(f"  🔧 处理 #{issue_num}: {issue['title'][:50]}...")
            
            # TODO: 这里需要根据 issue 内容编写修复代码
            # 目前只是示例，实际需要 AI 分析 issue 并生成代码
            
            # 模拟提交
            # pr_url = submit_pr(repo, issue_num, issue["title"], "Fix description", ["file.sol"])
            # if pr_url:
            #     submitted[key].append(issue_num)
            #     submitted["total"] += 1
            #     total_new += 1
            #     print(f"    ✅ PR 提交成功: {pr_url}")
            
            # 限制每批处理数量
            if total_new >= 10:
                break
        
        if total_new >= 10:
            break
    
    # 保存更新
    save_submitted(submitted)
    
    print(f"\n📊 本次提交: {total_new} 个 PR")
    print(f"📊 总计: {submitted['total']} 个 PR")

if __name__ == "__main__":
    main()
