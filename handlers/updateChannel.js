// 
const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('channelUpdate', async (oldChannel, newChannel) => {
    try {
      if (oldChannel.name === newChannel.name && 
          oldChannel.topic === newChannel.topic && 
          oldChannel.nsfw === newChannel.nsfw && 
          oldChannel.parentId === newChannel.parentId && 
          oldChannel.permissionOverwrites.cache.equals(newChannel.permissionOverwrites.cache)) return;

      const guild = newChannel.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelUpdate });
      const updateLog = fetchedLogs.entries.first();
      if (!updateLog) return;

      const { executor } = updateLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Изменение канала";

      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const memberExecutor = await guild.members.fetch(executor.id).catch(() => null);
      if (!memberExecutor) return;

      if (!(await antiCrashHandler(memberExecutor, "channel_update_anti_crash", action))) return;

      // Откат изменений
      await newChannel.edit({
        name: oldChannel.name,
        topic: oldChannel.topic,
        nsfw: oldChannel.nsfw,
        parent: oldChannel.parentId,
        permissionOverwrites: oldChannel.permissionOverwrites.cache.map(po => ({
          id: po.id,
          allow: po.allow.toArray(),
          deny: po.deny.toArray()
        }))
      }).catch(() => {});

      const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(memberExecutor, rolesToRemove),
        checkBot(memberExecutor),
        quarantine(memberExecutor, rolesToRemove, action),
        dm(memberExecutor, action)
      ]);
    } catch (err) {
      console.error('Ошибка в updateChannel:', err);
    }
  });
};