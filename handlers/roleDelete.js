const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('roleDelete', async (role) => {
    try {
      console.log(`🚨 Удалена роль: ${role?.name || 'Неизвестно'} (${role?.id || '???'})`);

      const guild = role.guild;

      // Проверяем, есть ли у бота нужные права
      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        console.error("❌ Ошибка: у бота нет прав на просмотр логов аудита.");
        return;
      }

      console.log(`🔍 Получение логов аудита для сервера: ${guild.name} (${guild.id})`);

      // Ждем, пока Discord API отдаст актуальные данные
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Получаем логи аудита
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(err => {
        console.error(`⚠️ Ошибка получения логов аудита (игнорируется):`, err);
        return null;
    });

      if (!fetchedLogs) {
        console.log("❌ Логи аудита не получены.");
        return;
      }

      const deletionLog = fetchedLogs.entries.first();
      if (!deletionLog) {
        console.log("❌ В логах аудита нет записей об удалении роли.");
        return;
      }

      const { executor } = deletionLog;
      if (!executor || executor.id === client.user.id) return;

      console.log(`👀 Роль удалена пользователем: ${executor.tag} (${executor.id})`);

      const action = "Удаление роли";

      // Проверка вайтлиста
      const whitelistColl = db.collection('whitelist');
      const whitelistDoc = await whitelistColl.findOne({ _id: guild.id }) || { whitelist: [] };

      if (whitelistDoc.whitelist.includes(executor.id)) {
        console.log(`✅ ${executor.tag} находится в вайтлисте.`);
        return;
      }

      const member = await guild.members.fetch(executor.id).catch(() => null);
      if (!member) {
        console.error(`❌ Ошибка: ${executor.tag} (${executor.id}) не найден в сервере.`);
        return;
      }

      // Проверка антикраша
      if (!(await antiCrashHandler(member, "role_anti_crash", action))) {
      }

      // Восстановление роли
      const newRole = await guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        permissions: new PermissionsBitField(role.permissions).bitfield,
        mentionable: role.mentionable,
        reason: "Авто-восстановление удаленной роли",
      });

      console.log(`✅ Восстановлена роль: ${newRole.name} (${newRole.id})`);

      // Восстановление позиций
      await newRole.setPosition(role.position).catch(() => {});

      // Восстановление пользователей с этой ролью
      const backupColl = db.collection('role_backups');
      const roleBackup = await backupColl.findOne({ roleId: role.id });

      if (roleBackup) {
        for (const userId of roleBackup.users) {
          const user = await guild.members.fetch(userId).catch(() => null);
          if (user) {
            await user.roles.add(newRole).catch(() => {});
          }
        }
      }

      // Обновление базы (замена старого ID роли на новый)
      await backupColl.updateOne({ roleId: role.id }, { $set: { roleId: newRole.id } });

      // Наказание удалившего
      const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id);
      await Promise.all([
        removeRoles(member, rolesToRemove),
        checkBot(member),
        quarantine(member, rolesToRemove, action),
        dm(member, action)
      ]);

      console.log(`🚨 ${executor.tag} наказан за удаление роли.`);
    } catch (err) {
      console.error('❌ Ошибка в roleDelete:', err);
    }
  });
};