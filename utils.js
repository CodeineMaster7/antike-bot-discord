const mongoose = require('mongoose');
const { EmbedBuilder } = require('discord.js');
const config = require('./configs/antinuke.json');

const mongoURI = config.mongodb;

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB подключена'))
  .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

const db = mongoose.connection;

const whitelistSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  whitelist: { type: [String], default: [] }
});
const Whitelist = mongoose.model('Whitelist', whitelistSchema);

const backupSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  roles: { type: [String], default: [] },
  quarantine: { type: Boolean, default: false }
});
const Backup = mongoose.model('Backup', backupSchema);

async function isWhitelisted(guildId, userId) {
  console.log(`🔍 Проверка вайтлиста: ${userId}`);
  const doc = await Whitelist.findOne({ guildId }).lean();
  const result = doc?.whitelist.includes(userId) || false;
  console.log(`✅ Результат проверки вайтлиста: ${userId} -> ${result ? 'Вайтлист' : 'Не вайтлист'}`);
  return result;
}

async function checkBot(member) {
  console.log(`🤖 Проверка бота: ${member.user.tag} (${member.id})`);
  if (member.user.bot) {
    try {
      console.log(`⛔ Бот ${member.user.tag} будет кикнут.`);
      await member.kick('Anti-crash: бот');
    } catch (err) {
      console.error('❌ Ошибка при кике бота:', err);
    }
  }
}

async function removeRoles(member, rolesToRemove) {
    console.log(`⚠️ Удаление ролей у: ${member.user.tag} (${member.id})`);

    // Если rolesToRemove — это коллекция, конвертируем в массив
    if (rolesToRemove instanceof Map || rolesToRemove instanceof require('discord.js').Collection) {
        rolesToRemove = [...rolesToRemove.values()];
    }

    if (!Array.isArray(rolesToRemove) || rolesToRemove.some(r => !r || !r.id)) {
        console.error('❌ Ошибка: некорректный список ролей.', rolesToRemove);
        return;
    }

    const rolesIDs = rolesToRemove.map(r => r.id);

    await Backup.updateOne(
        { userId: member.id },
        { $set: { roles: rolesIDs, quarantine: false } },
        { upsert: true }
    );

    await member.roles.remove(rolesIDs);
    console.log(`✅ Роли удалены у: ${member.user.tag}`);
}

async function quarantine(member, removedRoles, action) {
    console.log(`🚨 Карантин для: ${member.user.tag} (${member.id})`);
  
    try {
      // Проверяем канал карантина
      const quarantineChannelId = config.quarantine_channel;
      console.log(`🔍 Проверка карантинного канала: ${quarantineChannelId}`);
      
      const quarantineChannel = await member.guild.channels.fetch(quarantineChannelId).catch(err => {
        console.error(`❌ Ошибка поиска канала карантина: ${err}`);
        return null;
      });
      
      if (!quarantineChannel) {
        console.error(`❌ Ошибка: Канал с ID ${quarantineChannelId} не найден.`);
        return;
      }
  
      // Определяем группу, к которой относится пользователь
      const groupRoles = {
        "Администратор": "112233445566778899", // ID роли администратора
        "Модератор": "998877665544332211", // ID роли модератора
        "Участник": "223344556677889900" // ID обычного участника
      };

      let userGroup = "Неизвестно";
      for (const [groupName, roleId] of Object.entries(groupRoles)) {
        if (member.roles.cache.has(roleId)) {
          userGroup = groupName;
          break;
        }
      }

      // Проверяем и отправляем embed
      const rolesText = removedRoles?.size ? removedRoles.map(r => r.name).join(', ') : 'Нет';
      console.log(`🔹 Убранные роли: ${rolesText}`);
  
      const embed = new EmbedBuilder()
        .setColor(3092790)
        .addFields([
          { name: "> Пользователь:", value: `・${member} \n・${member.user.tag}\n・**${member.id}**` },
          { name: "> Действие:", value: `\`\`\`${action}\`\`\`` },
          { name: "> Убранные роли:", value: rolesText },
          { name: "> Группа пользователя:", value: `\`\`\`${userGroup}\`\`\`` } // Добавлено поле с группой
        ])
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setAuthor({ name: `🚨 Карантин | ${member.guild.name}`, iconURL: member.guild.iconURL({ dynamic: true }) });
  
      await quarantineChannel.send({ embeds: [embed] });
      console.log(`📩 Сообщение о карантине отправлено в ${quarantineChannel.name}`);
  
  // Обновление в базе данных
  await Backup.updateOne(
    { userId: member.id },
    { $set: { quarantine: true } },
    { upsert: true }
  );
  
  // Добавляем роль блокировки, если она найдена
  const banRole = await member.guild.roles.fetch(config.ban).catch(err => {
    console.error(`❌ Ошибка поиска роли бана: ${err}`);
    return null;
  });
  
  if (banRole) {
    await member.roles.add(banRole).catch(err => {
      console.error(`❌ Ошибка при выдаче роли бана: ${err}`);
    });
  } else {
    console.warn(`⚠️ Роль с ID ${config.ban} не найдена. Пропускаем выдачу роли.`);
  }
  
  console.log(`✅ ${member.user.tag} отправлен в карантин.`);
    } catch (err) {
      console.error('❌ Ошибка quarantine:', err);
    }
}

async function dm(member, action) {
  console.log(`📩 Отправка DM: ${member.user.tag} -> ${action}`);
  try {
    const embed = new EmbedBuilder()
      .setColor(3092790)
      .setDescription(`${member}, **Вы** были наказаны за **${action}**`)
      .setAuthor({ name: `Анти-краш ${member.guild.name}`, iconURL: member.guild.iconURL({ dynamic: true }) })
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

    await member.send({ embeds: [embed] }).catch(() => {});
    console.log(`✅ DM отправлено: ${member.user.tag}`);
  } catch (err) {
    console.error('❌ Ошибка при отправке DM:', err);
  }
}

async function antiCrashHandler(member, permissionField, action) {
    console.log(`🔍 Проверка антикраша: ${member.user.tag} (${member.id})`);
    try {
        const antiCrashDocs = await Whitelist.find({}).lean();
        console.log(`📄 Найдено ${antiCrashDocs.length} документов в Whitelist.`);

        let isAllowed = false;
        const roles = member.roles.cache.filter(role => role.id !== member.guild.id); // Исключаем @everyone

        if (roles.size === 0) {
            console.log(`⚠️ У пользователя ${member.user.tag} нет ролей (кроме @everyone).`);
            return false;
        }

        for (const role of roles.values()) {
            console.log(`🔎 Проверка роли: ${role.name} (${role.id})`);
            for (const group of antiCrashDocs) {
                console.log(`➡️ Сравниваем с группой: ${group._id}`);

                if (role.id === group._id) {
                    const finalResult = group[permissionField];
                    console.log(`📌 Найдено значение: ${finalResult}`);

                    if (finalResult === 'Запрещено') {
                        console.log(`⛔ ${member.user.tag} нарушил правило и будет наказан.`);
                        return true;
                    }
                    if (finalResult === 'Разрешено') {
                        console.log(`✅ ${member.user.tag} имеет разрешение.`);
                        isAllowed = true;
                    }

                    if (!isNaN(finalResult)) {
                        console.log(`⚠️ ${member.user.tag} имеет ${finalResult} нарушений.`);
                        await Backup.updateOne(
                            { userId: member.id },
                            { $set: { quarantine: true } },
                            { upsert: true }
                        );

                        if (member.quarantine >= Number(finalResult)) {
                            console.log(`⛔ ${member.user.tag} превысил лимит и будет наказан.`);
                            return true;
                        } else {
                            console.log(`⚠️ ${member.user.tag} не превысил лимит (${finalResult}), отправка предупреждения.`);
                            await dm(member, `Превышено количество нарушений: ${finalResult}`);
                            return false;
                        }
                    }
                }
            }
        }

        console.log(`🎯 Проверка завершена. Разрешен: ${isAllowed}`);
        return isAllowed;
    } catch (err) {
        console.error('❌ Ошибка antiCrashHandler:', err);
        return false;
    }
}

module.exports = {
  db,
  Whitelist,
  Backup,
  isWhitelisted,
  checkBot,
  removeRoles,
  quarantine,
  dm,
  antiCrashHandler
};