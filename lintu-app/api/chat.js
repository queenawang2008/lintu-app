// ============================================================
//  林途规划工作台 / Lintu — Coze Bot 代理 (Vercel Serverless)
//  ⚠️ 调试版：当扣子返回里没有 answer 时，把整个原始 messages
//      列表的关键信息回传给前端，方便定位"未获取到有效数据"问题。
//      问题修复后请回滚到生产版（去掉 DEBUG 输出）。
// ============================================================

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '只允许 POST 请求' });
    }

    const API_TOKEN = process.env.COZE_API_TOKEN;
    const BOT_ID = process.env.COZE_BOT_ID;

    if (!API_TOKEN || !BOT_ID) {
        return res.status(500).json({
            error: '服务未正确配置：请在 Vercel 设置 COZE_API_TOKEN 与 COZE_BOT_ID 环境变量'
        });
    }

    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: '没有收到查询关键词' });
    }

    try {
        // 1. 发起对话
        const chatRes = await fetch('https://api.coze.cn/v3/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bot_id: BOT_ID,
                user_id: "user_" + Math.floor(Math.random() * 100000),
                stream: false,
                auto_save_history: true,
                additional_messages: [{
                    role: "user",
                    content: text,
                    content_type: "text"
                }]
            })
        });

        const chatData = await chatRes.json();
        if (chatData.code !== 0) {
            throw new Error(chatData.msg || "云端对接扣子失败");
        }

        const chatId = chatData.data.id;
        const convId = chatData.data.conversation_id;

        // 2. 轮询等待回答
        let isCompleted = false;
        let timeout = 0;
        let lastStatus = '';
        const MAX_WAIT_SECONDS = 60;

        while (!isCompleted && timeout < MAX_WAIT_SECONDS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            timeout++;

            const statusRes = await fetch(
                `https://api.coze.cn/v3/chat/retrieve?chat_id=${chatId}&conversation_id=${convId}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${API_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            const statusData = await statusRes.json();
            const status = statusData?.data?.status;
            lastStatus = status;

            if (status === 'completed') {
                isCompleted = true;
            } else if (status === 'failed' || status === 'canceled' || status === 'requires_action') {
                throw new Error(`模型处理中断（状态：${status}）`);
            }
        }

        if (!isCompleted) {
            throw new Error(`林途大脑思考超时（最后状态：${lastStatus}）`);
        }

        // 3. 拉消息列表
        const msgRes = await fetch(
            `https://api.coze.cn/v3/chat/message/list?chat_id=${chatId}&conversation_id=${convId}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const msgData = await msgRes.json();

        const allMessages = msgData?.data || [];
        const botMessages = allMessages.filter(m => m.type === 'answer');

        if (botMessages.length > 0) {
            return res.status(200).json({
                reply: botMessages[botMessages.length - 1].content
            });
        }

        // 没拿到 answer 类型 → 诊断模式，把扣子返回的内容回显
        const debugSummary = allMessages.map((m, idx) => {
            const preview = typeof m.content === 'string'
                ? m.content.slice(0, 200)
                : JSON.stringify(m.content || {}).slice(0, 200);
            return `【消息 ${idx + 1}】type=${m.type} | role=${m.role} | content_type=${m.content_type} | content="${preview}"`;
        }).join('\n\n');

        const diag = [
            '🔬 诊断模式：扣子接口已经返回，但其中没有 type="answer" 类型的回答。',
            `📊 总共收到 ${allMessages.length} 条消息：`,
            '',
            debugSummary || '（消息列表为空，扣子接口完全没有返回任何 message）',
            '',
            '🩺 常见原因：',
            '1. 扣子智能体没有发布到 API 渠道（最常见）',
            '2. 智能体绑定的模型出错或额度耗尽',
            '3. 智能体配置的工作流走到了空分支',
            '',
            `🆔 chat_id: ${chatId}`,
            `🆔 conversation_id: ${convId}`,
            `🆔 status: ${lastStatus}`
        ].join('\n');

        return res.status(200).json({ reply: diag });

    } catch (error) {
        return res.status(500).json({ error: error.message || '未知错误' });
    }
}
