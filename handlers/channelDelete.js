const { AuditLogEvent, ChannelType } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('channelDelete', async (channel) => {
    try {
      if (!channel || !channel.guild) return;

      const guild = channel.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
      if (!fetchedLogs) return;

      const deletionLog = fetchedLogs.entries.first();
      if (!deletionLog) return;

      const { executor } = deletionLog;
      if (!executor || executor.id === guild.client.user.id) return;

      const action = "Удаление канала";

      // Получаем вайтлист
      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      // Проверка антикраша
      if (!(await antiCrashHandler(member, "channel_anti_crash", action)));

      // Восстановление канала
      let newChannel;
      if (channel.type === ChannelType.GuildText) {
        newChannel = await guild.channels.create({
          name: channel.name,
          type: ChannelType.GuildText,
          topic: channel.topic || null,
          nsfw: channel.nsfw,
          parent: channel.parentId,
          position: channel.position,
          permissionOverwrites: channel.permissionOverwrites.cache.map(po => ({
            id: po.id,
            allow: po.allow.toArray(),
            deny: po.deny.toArray()
          }))
        });
      } else if (channel.type === ChannelType.GuildVoice) {
        newChannel = await guild.channels.create({
          name: channel.name,
          type: ChannelType.GuildVoice,
          parent: channel.parentId,
          position: channel.position,
          permissionOverwrites: channel.permissionOverwrites.cache.map(po => ({
            id: po.id,
            allow: po.allow.toArray(),
            deny: po.deny.toArray()
          }))
        });
      }

      console.log(`✅ Восстановлен канал: ${newChannel.name}`);

      // Наказание пользователя
      const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id);

      await Promise.all([
        removeRoles(member, rolesToRemove),
        checkBot(member),
        quarantine(member, rolesToRemove, action),
        dm(member, action)
      ]);
    } catch (err) {
      console.error('❌ Ошибка в обработчике channelDelete:', err);
    }
  });
};