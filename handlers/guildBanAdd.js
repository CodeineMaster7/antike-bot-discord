const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('guildBanAdd', async (ban) => {
    try {
      const guild = ban.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
      const banLog = fetchedLogs.entries.first();
      if (!banLog) return;

      const { executor, target } = banLog;
      if (!executor || executor.id === client.user.id || executor.id === target.id) return;

      const action = "Бан участника";
      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      if (!(await antiCrashHandler(member, "ban_anti_crash", action)));

      // Разбан жертвы
      await guild.members.unban(target.id).catch(() => {});

      const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(member, rolesToRemove),
        checkBot(member),
        quarantine(member, rolesToRemove, action),
        dm(member, action)
      ]);
    } catch (err) {
      console.error('Ошибка в guildBanAdd:', err);
    }
  });
};