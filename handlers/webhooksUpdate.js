const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  setInterval(async () => {
    try {
      client.guilds.cache.forEach(async (guild) => {
        const fetchedLogs = await guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.WebhookCreate });
        const webhookLogs = fetchedLogs.entries.filter(log => log.createdTimestamp > Date.now() - 10000); // Последние 10 секунд

        webhookLogs.forEach(async (log) => {
          const { executor } = log;
          if (!executor || executor.id === client.user.id) return;

          console.log(`⚠️ Обнаружено создание вебхука: ${executor.tag}`);

          const whitelistColl = db.collection('whitelist');
          let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

          if (!whitelistDoc) {
            await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
            whitelistDoc = { whitelist: [] };
          }

          if (whitelistDoc.whitelist.includes(executor.id)) return;

          const memberExecutor = await guild.members.fetch(executor.id).catch(() => null);
          if (!memberExecutor) return;

          if (!(await antiCrashHandler(memberExecutor, "webhook_create_anti_crash", "Создание вебхука"))) {
            console.log(`⛔ ${executor.tag} нарушил правило, применяем санкции.`);

            const webhooks = await guild.fetchWebhooks().catch(() => []);
            await Promise.all(webhooks.map(wh => wh.delete().catch(err => console.error(`❌ Ошибка удаления вебхука:`, err))));

            const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== guild.id);
            await Promise.all([
              removeRoles(memberExecutor, rolesToRemove),
              checkBot(memberExecutor),
              quarantine(memberExecutor, rolesToRemove, "Создание вебхука"),
              dm(memberExecutor, "Создание вебхука")
            ]).catch(err => console.error(`❌ Ошибка в Promise.all:`, err));
          }
        });
      });
    } catch (err) {
      console.error('❌ Ошибка в проверке вебхуков:', err);
    }
  }, 10000); // Проверка каждые 10 секунд
};