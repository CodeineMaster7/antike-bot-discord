const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('roleCreate', async (role) => {
    try {
      const guild = role.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate });
      const creationLog = fetchedLogs.entries.first();
      if (!creationLog) return;

      const { executor } = creationLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Создание роли";
      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      if (!(await antiCrashHandler(member, "role_anti_crash", action)));

      // Удаляем созданную роль
      await role.delete().catch(() => {});

      const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(member, rolesToRemove),
        checkBot(member),
        quarantine(member, rolesToRemove, action),
        dm(member, action)
      ]);
    } catch (err) {
      console.error('Ошибка в roleCreate:', err);
    }
  });
};