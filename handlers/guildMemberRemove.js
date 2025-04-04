const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('guildMemberRemove', async (member) => {
    try {
      const guild = member.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
      const kickLog = fetchedLogs.entries.first();
      if (!kickLog) return;

      const { executor } = kickLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Кик участника";
      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const memberExecutor = await guild.members.fetch(executor.id).catch(() => null);
      if (!memberExecutor) return;

      if (!(await antiCrashHandler(memberExecutor, "kick_anti_crash", action)));

      const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(memberExecutor, rolesToRemove),
        checkBot(memberExecutor),
        quarantine(memberExecutor, rolesToRemove, action),
        dm(memberExecutor, action)
      ]);
    } catch (err) {
      console.error('Ошибка в guildMemberRemove:', err);
    }
  });
};