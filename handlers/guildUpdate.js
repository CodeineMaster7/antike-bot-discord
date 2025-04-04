const { AuditLogEvent } = require('discord.js');
const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('guildUpdate', async (oldGuild, newGuild) => {
    try {
      const fetchedLogs = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate });
      const updateLog = fetchedLogs.entries.first();
      if (!updateLog) return;

      const { executor } = updateLog;
      if (!executor || executor.id === client.user.id) return;

      let action = "Изменение настроек сервера";
      let antiCrashType = "guild_update_other_anti_crash";
      let rollbackData = {}; // Данные для отката изменений

      // Проверяем, что именно изменилось и готовим откат
      if (oldGuild.name !== newGuild.name) {
        action = "Изменение названия сервера";
        antiCrashType = "guild_update_name_anti_crash";
        rollbackData.name = oldGuild.name;
      } 
      if (oldGuild.icon !== newGuild.icon) {
        action = "Изменение аватара сервера";
        antiCrashType = "guild_update_avatar_anti_crash";
        rollbackData.icon = oldGuild.iconURL();
      } 
      if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        action = "Изменение уровня проверки";
        antiCrashType = "guild_update_verification_anti_crash";
        rollbackData.verificationLevel = oldGuild.verificationLevel;
      }

      console.log(`⚠️ Обнаружено изменение: ${action} | Исполнитель: ${executor.tag}`);

      // Проверка вайтлиста
      const Whitelist = db.model('Whitelist');
      let whitelistDoc = await Whitelist.findOne({ guildId: newGuild.id }).lean();

      if (!whitelistDoc) {
        await Whitelist.create({ guildId: newGuild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) {
        console.log(`✅ ${executor.tag} в вайтлисте. Антикраш не применяется.`);
        return;
      }

      const memberExecutor = await newGuild.members.fetch(executor.id).catch(err => {
        console.error(`❌ Ошибка при получении участника ${executor.id}:`, err);
        return null;
      });

      if (!memberExecutor) return;

      if (!(await antiCrashHandler(memberExecutor, antiCrashType, action))) {
        console.log(`⛔ ${executor.tag} нарушил правило, применяем санкции.`);

        const rolesToRemove = memberExecutor.roles.cache.filter(r => r.id !== newGuild.id);
        await Promise.all([
          removeRoles(memberExecutor, rolesToRemove),
          checkBot(memberExecutor),
          quarantine(memberExecutor, rolesToRemove, action),
          dm(memberExecutor, action)
        ]).catch(err => console.error(`❌ Ошибка в Promise.all:`, err));

        // Откатываем изменения сервера
        if (Object.keys(rollbackData).length > 0) {
          await newGuild.edit(rollbackData).catch(err => 
            console.error(`❌ Ошибка при откате изменений сервера:`, err)
          );
          console.log(`🔄 Откат изменений сервера успешно выполнен.`);
        }
      }
    } catch (err) {
      console.error('❌ Ошибка в guildUpdate:', err);
    }
  });
};