const { db, antiCrashHandler, removeRoles, checkBot, quarantine, dm } = require('../utils.js');

module.exports = async (client) => {
  client.on('messageCreate', async (message) => {
    try {
      if (!message.guild || !message.author || message.author.bot) return;

      const guild = message.guild;
      const executor = message.author;
      const content = message.content.toLowerCase();

      // Проверка на массовые упоминания, @everyone и @here
      if (
        content.includes("@everyone") ||
        content.includes("@here")
      ) {
        const action = "Спам упоминаниями (@everyone/@here/массовые упоминания)";

        try {
          const Whitelist = db.model('Whitelist');
          let whitelistDoc = await Whitelist.findOne({ guildId: guild.id }).lean();

          if (!whitelistDoc) {
            await Whitelist.create({ guildId: guild.id, whitelist: [] });
            whitelistDoc = { whitelist: [] };
          }

          if (whitelistDoc.whitelist.includes(executor.id)) return;

          const member = await guild.members.fetch(executor.id).catch(err => {
            console.error(`❌ Ошибка при получении участника ${executor.id}:`, err);
            return null;
          });

          if (!member) return;

          if (!(await antiCrashHandler(member, "spam_anti_crash", action)));

          await message.delete().catch(err => {
            console.error(`⚠️ Ошибка при удалении сообщения:`, err);
          });

          const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id);

          await Promise.all([
            removeRoles(member, rolesToRemove),
            checkBot(member),
            quarantine(member, rolesToRemove, action),
            dm(member, action)
          ]).catch(err => console.error(`❌ Ошибка в Promise.all:`, err));

        } catch (err) {
          console.error(`❌ Ошибка при проверке whitelist:`, err);
        }
      }
    } catch (err) {
      console.error('❌ Ошибка в messageCreate:', err);
    }
  });
};