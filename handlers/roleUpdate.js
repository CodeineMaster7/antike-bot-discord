const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('roleUpdate', async (oldRole, newRole) => {
    try {
      const guild = oldRole.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate });
      const updateLog = fetchedLogs.entries.first();
      if (!updateLog) return;

      const { executor } = updateLog;
      if (!executor || executor.id === client.user.id) return;

      // Получаем старые и новые права
      const oldPermissions = new PermissionsBitField(oldRole.permissions);
      const newPermissions = new PermissionsBitField(newRole.permissions);

      let action, antiCrashType;
      let shouldRevert = false; // Нужно ли откатывать изменения

      // Проверяем, были ли выданы админские права
      if (!oldPermissions.has(PermissionsBitField.Flags.Administrator) && 
           newPermissions.has(PermissionsBitField.Flags.Administrator)) {
        action = "Выдача админ прав на роль";
        antiCrashType = "role_create_admin_anti_crash";
        shouldRevert = true;
        console.log(`⚠️ Обнаружена выдача админ-прав! Роль: ${newRole.name}, Исполнитель: ${executor.tag}`);
      } else {
        action = "Изменение роли";
        antiCrashType = "role_update_anti_crash";
        console.log(`ℹ️ Изменение роли без админ-прав: ${newRole.name}, Исполнитель: ${executor.tag}`);
      }

      try {
        const Whitelist = db.model('Whitelist');
        let whitelistDoc = await Whitelist.findOne({ guildId: guild.id }).lean();

        if (!whitelistDoc) {
          await Whitelist.create({ guildId: guild.id, whitelist: [] });
          whitelistDoc = { whitelist: [] };
        }

        if (whitelistDoc.whitelist.includes(executor.id)) {
          console.log(`✅ ${executor.tag} в вайтлисте. Антикраш не применяется.`);
          return;
        }

        const memberExecutor = await guild.members.fetch(executor.id).catch(err => {
          console.error(`❌ Ошибка при получении участника ${executor.id}:`, err);
          return null;
        });

        if (!memberExecutor) return;

        const isAllowed = await antiCrashHandler(memberExecutor, antiCrashType, action);
        if (!isAllowed) {
          console.log(`⛔ ${executor.tag} нарушил правило, применяем санкции.`);

          // Если надо откатить админ-изменения, возвращаем старые права
          if (shouldRevert) {
            await newRole.setPermissions(oldPermissions).catch(err => {
              console.error(`❌ Ошибка при откате прав роли:`, err);
            });
          }

          const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== guild.id);

          await Promise.all([
            removeRoles(memberExecutor, rolesToRemove),
            checkBot(memberExecutor),
            quarantine(memberExecutor, rolesToRemove, action),
            dm(memberExecutor, action)
          ]).catch(err => console.error(`❌ Ошибка в Promise.all:`, err));
        }
      } catch (err) {
        console.error(`❌ Ошибка при проверке whitelist:`, err);
      }
    } catch (err) {
      console.error('❌ Ошибка в roleUpdate:', err);
    }
  });
};