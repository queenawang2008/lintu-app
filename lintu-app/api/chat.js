// ============================================================
//  林途规划工作台 / Lintu — Coze Bot 代理 (Vercel Serverless)
// ============================================================
//  安全要点：
//  - API Token 必须通过 Vercel 环境变量 COZE_API_TOKEN 注入，
//    绝不能硬编码到代码里（公开仓库会被爬走、扣费）。
//  - BOT_ID 也建议放到环境变量 COZE_BOT_ID，方便切换不同智能体。
// ============================================================

export default async function handler(req, res) {
    // ---------- 1. 基础校验 ----------
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

    // ---------- 2. 发起对话 ----------
    try {
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

        // ---------- 3. 轮询等待模型回答（最多 45 秒） ----------
        let isCompleted = false;
        let timeout = 0;
        const MAX_WAIT_SECONDS = 45;

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

            if (status === 'completed') {
                isCompleted = true;
            } else if (status === 'failed' || status === 'canceled' || status === 'requires_action') {
                throw new Error(`模型处理中断（状态：${status}）`);
            }
        }

        if (!isCompleted) {
            throw new Error("林途大脑思考超时，请稍后再问一次");
        }

        // ---------- 4. 取回最终消息 ----------
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

        const botMessages = (msgData?.data || []).filter(m => m.type === 'answer');
        const finalReply = botMessages.length > 0
            ? botMessages[botMessages.length - 1].content
            : "未获取到有效数据";

        return res.status(200).json({ reply: finalReply });

    } catch (error) {
        return res.status(500).json({ error: error.message || '未知错误' });
    }
}
