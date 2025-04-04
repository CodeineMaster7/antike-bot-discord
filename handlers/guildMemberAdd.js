const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('guildMemberAdd', async (member) => {
    try {
      if (!member.user.bot) return;

      const guild = member.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.BotAdd });
      const addLog = fetchedLogs.entries.first();
      if (!addLog) return;

      const { executor } = addLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Добавление бота";
      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const memberExecutor = await guild.members.fetch(executor.id).catch(() => null);
      if (!memberExecutor) return;

      if (!(await antiCrashHandler(memberExecutor, "bot_anti_crash", action)));

      // Кикаем бота
      await member.kick().catch(() => {});

      const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(memberExecutor, rolesToRemove),
        checkBot(memberExecutor),
        quarantine(memberExecutor, rolesToRemove, action),
        dm(memberExecutor, action)
      ]);
    } catch (err) {
      console.error('Ошибка в guildMemberAdd:', err);
    }
  });
};