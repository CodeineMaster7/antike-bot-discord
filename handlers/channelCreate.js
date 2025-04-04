const { AuditLogEvent } = require('discord.js');
const { db, Whitelist, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('channelCreate', async (channel) => {
    try {
      const guild = channel.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate });
      const creationLog = fetchedLogs.entries.first();
      if (!creationLog) return;

      const { executor } = creationLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Создание канала";

      // Проверка вайтлиста
      let whitelistDoc = await Whitelist.findOne({ guildId: guild.id }).lean();
      if (!whitelistDoc) {
        whitelistDoc = await Whitelist.create({ guildId: guild.id, whitelist: [] });
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      // Проверка антикраша
      if (!(await antiCrashHandler(member, "channel_anti_crash", action)));

      // Удаление канала
      await channel.delete().catch(err => console.error(`❌ Ошибка при удалении канала: ${err.message}`));

      const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(member, rolesToRemove),
        checkBot(member),
        quarantine(member, rolesToRemove, action),
        dm(member, action)
      ]);
    } catch (err) {
      console.error('❌ Ошибка в обработчике channelCreate:', err);
    }
  });
};