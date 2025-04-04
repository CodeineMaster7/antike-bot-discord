const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const guild = newMember.guild;

      // Получаем логи аудита с задержкой, чтобы они успели обновиться
      await new Promise(resolve => setTimeout(resolve, 1000));
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberRoleUpdate });
      const roleUpdateLog = fetchedLogs.entries.first();
      if (!roleUpdateLog) return;

      const { executor, target } = roleUpdateLog;
      if (!executor || executor.id === client.user.id || target.id !== newMember.id) return;

      const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
      const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

      if (addedRoles.size === 0 && removedRoles.size === 0) return;

      let action = "Изменение ролей участника";
      let antiCrashType = "role_update_anti_crash";

      // Проверяем, есть ли среди добавленных ролей админские права
      const hasAdminRole = addedRoles.some(role => role.permissions.has(PermissionsBitField.Flags.Administrator));
      if (hasAdminRole) {
        action = "Выдача роли с админ-правами";
        antiCrashType = "role_create_admin_anti_crash";
        console.log(`⚠️ Обнаружена выдача админ-прав! Исполнитель: ${executor.tag}, цель: ${target.tag}`);
      }

      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) {
        console.log(`✅ ${executor.tag} в вайтлисте. Антикраш не применяется.`);
        return;
      }

      const memberExecutor = await guild.members.fetch(executor.id).catch(() => null);
      if (!memberExecutor) return;

      if (!(await antiCrashHandler(memberExecutor, antiCrashType, action))) {
        console.log(`⛔ ${executor.tag} нарушил правило, применяем санкции.`);

        // Откатываем изменения ролей
        await newMember.roles.set(oldMember.roles.cache.map(role => role.id)).catch(() => {});

        // Применяем санкции к нарушителю
        const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== guild.id);
        await Promise.all([
          removeRoles(memberExecutor, rolesToRemove),
          checkBot(memberExecutor),
          quarantine(memberExecutor, rolesToRemove, action),
          dm(memberExecutor, action)
        ]).catch(err => console.error(`❌ Ошибка в Promise.all:`, err));
      }
    } catch (err) {
      console.error('❌ Ошибка в guildMemberUpdate:', err);
    }
  });
};