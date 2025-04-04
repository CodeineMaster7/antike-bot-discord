const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('guildBanRemove', async (ban) => {
    try {
      const guild = ban.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanRemove });
      const unbanLog = fetchedLogs.entries.first();
      if (!unbanLog) return;

      const { executor } = unbanLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Разбан пользователя";

      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const memberExecutor = await guild.members.fetch(executor.id).catch(() => null);
      if (!memberExecutor) return;

      if (!(await antiCrashHandler(memberExecutor, "unban_anti_crash", action)));

      // Повторно баним пользователя
      await guild.bans.create(ban.user, { reason: "Автоматическая защита от антирейда" }).catch(() => {});

      const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(memberExecutor, rolesToRemove),
        checkBot(memberExecutor),
        quarantine(memberExecutor, rolesToRemove, action),
        dm(memberExecutor, action)
      ]);
    } catch (err) {
      console.error('Ошибка в unban:', err);
    }
  });
};