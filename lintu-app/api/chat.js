export default async function handler(req, res) {
    // 保护机制：只允许前端发送 POST 提问请求
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '只允许 POST 请求' });
    }

    // 🔐 你的真钥匙锁在这里！任何人都扒不到！
    const API_TOKEN = "sat_9LiYIkLDXHHCdHEkdUqZ7t265m37PGD19Vlu9oHujmZOohge24bPl6R9SBbDyVJv"; 
    const BOT_ID = "7641616811686936610";

    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ error: '没有收到查询关键词' });
    }

    try {
        // 1. 在云端偷偷发起与扣子的对话
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
        if (chatData.code !== 0) throw new Error(chatData.msg || "云端对接扣子失败");

        const chatId = chatData.data.id;
        const convId = chatData.data.conversation_id;

        // 2. 轮询等待大模型思考完毕（最多等 30 秒防卡死）
        let isCompleted = false;
        let timeout = 0;
        while (!isCompleted && timeout < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            timeout++;

            const statusRes = await fetch(`https://api.coze.cn/v3/chat/retrieve?chat_id=${chatId}&conversation_id=${convId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            const statusData = await statusRes.json();
            if (statusData.data.status === 'completed') {
                isCompleted = true;
            } else if (statusData.data.status === 'failed' || statusData.data.status === 'canceled') {
                throw new Error("模型处理中断");
            }
        }

        if (!isCompleted) throw new Error("扣子大脑思考超时");

        // 3. 提取最终的毒舌报告并返回给前端
        const msgRes = await fetch(`https://api.coze.cn/v3/chat/message/list?chat_id=${chatId}&conversation_id=${convId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        const msgData = await msgRes.json();
        
        const botMessages = msgData.data.filter(m => m.type === 'answer');
        let finalReply = botMessages.length > 0 ? botMessages[botMessages.length - 1].content : "未获取到有效数据";

        return res.status(200).json({ reply: finalReply });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}