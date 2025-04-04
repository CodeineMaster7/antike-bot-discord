// antiCrash.js
const { Client, GatewayIntentBits, AuditLogEvent, ChannelType, EmbedBuilder, PermissionsBitField } = require('discord.js');
const config = require('./configs/antinuke.json');
const mongoose = require('mongoose');

// Создаём клиента Discord (настраивайте intents по необходимости)
const client = new Client({
  intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildBans,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessageTyping,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent
  ]
});

const mongoURI = config.mongodb;

// Подключение к MongoDB
let db;
mongoose.connect(mongoURI)
.then((connection) => {
  console.log("MongoDB connected");
  db = connection.connection.db;
})
.catch(err => console.error("MongoDB connection error:", err));

// ====== Вспомогательные функции ======

// Если участник – бот, пытаемся его кикнуть
async function checkBot(member) {
  if (member.user.bot) {
    try {
      await member.kick('Anti-crash: бот');
    } catch (err) {
      console.error('Ошибка при кике бота:', err);
    }
  }
}

// Удаляет указанные роли у участника и сохраняет их в backup коллекции
async function removeRoles(member, rolesToRemove) {
  try {
    const backupColl = getDb().collection('backup');
    await backupColl.updateOne(
      { _id: member.id },
      { $set: { roles: [] } },
      { upsert: true }
    );
    const rolesIDs = rolesToRemove.map(r => r.id);
    await backupColl.updateOne(
      { _id: member.id },
      { $push: { roles: { $each: rolesIDs } } },
      { upsert: true }
    );
    // Удаляем роли (игнорируем возможные ошибки)
    await member.roles.remove(rolesToRemove.map(r => r.id)).catch(() => {});
  } catch (err) {
    console.error('removeRoles error:', err);
  }
}

// Отправляет embed в канал карантина, обновляет backup и добавляет роль "бан" (ID берётся из config)
async function quarantine(member, removedRoles, action) {
  try {
    const quarantineChannel = await member.guild.channels.fetch(config.quarantine_channel);
    if (!quarantineChannel) return;
    const embed = new EmbedBuilder()
    .setColor(0x2ED573)
    .setTitle("🚨 Карантин")
    .addFields([
      { name: "> Пользователь:", value: `・${member} \n・${member.user.tag}\n・**${member.id}**` },
      { name: "> Действие:", value: `\`\`\`${action}\`\`\`` },
      { name: "> Убранные роли:", value: removedRoles.map(r => r.name).join(' ') || 'Нет' }
    ])
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setAuthor({ name: `🚨 Карантин ${member.guild.name}`, iconURL: member.guild.iconURL({ dynamic: true }) });
    const msg = await quarantineChannel.send({ embeds: [embed] });
    // Сохраняем id участника в backup (аналог cluster.antinuke.backup.update_one в Python)
    const backupColl = getDb().collection('backup');
    await backupColl.updateOne(
      { _id: msg.id },
      { $set: { quarantine: parseInt(member.id) } },
      { upsert: true }
    );
    // Добавляем роль "бан" (id берётся из config.ban)
    const banRole = member.guild.roles.cache.get(config.ban);
    if (banRole) await member.roles.add(banRole).catch(() => {});
  } catch (err) {
    console.error('quarantine error:', err);
  }
}

// Отправляет предупреждение в канал (предварительный) с информацией о предупреждениях
async function warning(member, finalResult, action) {
  try {
    const predChannel = await member.guild.channels.fetch(config.pred_channel);
    if (!predChannel) return;
    const anticrashColl = getDb().collection('anticrash');
    const data = await anticrashColl.findOne({ _id: member.id });
    const warningsCount = data ? data.quarantine : 0;
    const embed = new MessageEmbed()
      .setColor(0x2ED573)
      .addField("> Пользователь:", `・${member} \n・${member.user.tag}\n・**${member.id}**`)
      .addField("> Действие:", `\`\`\`${action}\`\`\``)
      .addField("> Предупреждений", `\`\`\`${warningsCount}/${finalResult}\`\`\``)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setAuthor({ name: `Получение предупреждения ${member.guild.name}`, iconURL: member.guild.iconURL({ dynamic: true }) });
    await predChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('warning error:', err);
  }
}

// Отправляет DM участнику
async function dm(member, action) {
  try {
    const embed = new MessageEmbed()
      .setColor(0x2ED573)
      .setDescription(`${member}, **Вы** были наказаны за **${action}**`)
      .setAuthor({ name: `Анти-краш ${member.guild.name}`, iconURL: member.guild.iconURL({ dynamic: true }) })
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
    await member.send({ embeds: [embed] });
  } catch (err) {
    // Игнорируем, если отправка DM невозможна
  }
}

// Проверяет настройки анти‑краша для участника по определённому разрешению (например, "ping_anti_crash")
// Если порог (числовое значение) не достигнут – отправляет предупреждение и возвращает false.
async function antiCrashHandler(member, permissionField, action) {
  const antiCrashColl = db.collection('anti_crash');
  const userAntiCrashColl = db.collection('anticrash');

  let userAntiCrash = await userAntiCrashColl.findOne({ _id: member.id });
  if (!userAntiCrash) {
      await userAntiCrashColl.insertOne({ _id: member.id, quarantine: 0 });
      userAntiCrash = { quarantine: 0 };
  }

  const antiCrashDocs = await antiCrashColl.find({}).toArray();
  let isAllowed = false;

  for (const role of member.roles.cache.values()) {
      for (const group of antiCrashDocs) {
          if (role.id === group._id) {
              const finalResult = group[permissionField];

              if (finalResult === 'Запрещено') return true;
              if (finalResult === 'Разрешено') isAllowed = true;

              if (!isNaN(finalResult)) {
                  await userAntiCrashColl.updateOne({ _id: member.id }, { $inc: { quarantine: 1 } });
                  userAntiCrash = await userAntiCrashColl.findOne({ _id: member.id });

                  if (userAntiCrash.quarantine >= Number(finalResult)) {
                      return true;
                  } else {
                      await warning(member, finalResult, action);
                      return false;
                  }
              }
          }
      }
  }
  return isAllowed;
}

// ====== Обработчики событий ======

// При получении сообщения (например, для проверки пингов)
client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return; // Игнорируем ЛС
    // Если сообщение от бота – пропускаем (а также можно запускать обработку команд здесь)
    if (message.author.bot) return;

    // Проверяем, что для гильдии есть документ whitelist, иначе создаём его
    const whitelistColl = getDb().collection('whitelist');
    let whitelistDoc = await whitelistColl.findOne({ _id: message.guild.id });
    if (!whitelistDoc) {
      await whitelistColl.insertOne({ _id: message.guild.id, whitelist: [] });
      whitelistDoc = { whitelist: [] };
    }

    // Если сообщение содержит запрещённые пинги
    if (message.content.toLowerCase().includes('@everyone') || message.content.toLowerCase().includes('@here')) {
      const action = "Запрещенные пинги";
      const member = message.member;
      if (!member) return;
      if (whitelistDoc.whitelist.includes(member.id)) return;

      // Если документа об анти‑краше для участника нет – создаём его
      const userAntiCrashColl = getDb().collection('anticrash');
      let userAntiCrash = await userAntiCrashColl.findOne({ _id: member.id });
      if (!userAntiCrash) await userAntiCrashColl.insertOne({ _id: member.id, quarantine: 0 });

      // Проверяем настройки анти‑краша для пингов
      if (!(await antiCrashHandler(member, "ping_anti_crash", action))) return;

      // Удаляем сообщение
      await message.delete().catch(() => {});

      // Выбираем роли для удаления (исключаем @everyone)
      const rolesToRemove = member.roles.cache
        .filter(r => r.id !== message.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r);

      await Promise.all([
        removeRoles(member, rolesToRemove),
        checkBot(member),
        quarantine(member, rolesToRemove, action),
        dm(member, action)
      ]);
    }
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

// При выдаче бана
client.on('guildBanAdd', async (ban) => {
  try {
      const guild = ban.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
      const banLog = fetchedLogs.entries.first();
      if (!banLog) return;

      const { executor } = banLog;
      if (!executor) return; // Log not found

      if (executor.id === client.user.id) return; // Ignore bot bans

      const action = "Выдача бана";
      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
          await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
          whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = guild.members.cache.get(executor.id) ||
                     await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      if (!(await antiCrashHandler(member, "ban_anti_crash", action))) return;

      await guild.members.unban(ban.user.id, "Anti Nuke").catch(() => {});

      const rolesToRemove = member.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r);

      await Promise.all([
          removeRoles(member, rolesToRemove),
          checkBot(member),
          quarantine(member, rolesToRemove, action),
          dm(member, action)
      ]);
  } catch (err) {
      console.error('guildBanAdd error:', err);
  }
});

// При удалении канала
client.on('channelDelete', async (channel) => {
  try {
      const guild = channel.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
      const deletionLog = fetchedLogs.entries.first();
      if (!deletionLog) return;

      const { executor } = deletionLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Удаление канала";

      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
          await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
          whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = guild.members.cache.get(executor.id) ||
                     await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      if (!(await antiCrashHandler(member, "channel_anti_crash", action))) return;

      // Восстановление канала
      let newChannel;
      if (channel.type === ChannelType.GuildText) {
          newChannel = await guild.channels.create({
              name: channel.name,
              type: ChannelType.GuildText,
              topic: channel.topic,
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

      const rolesToRemove = member.roles.cache
          .filter(r => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map(r => r);

      await Promise.all([
          removeRoles(member, rolesToRemove),
          checkBot(member),
          quarantine(member, rolesToRemove, action),
          dm(member, action)
      ]);
  } catch (err) {
      console.error('Ошибка в channelDelete:', err);
  }
});

// При создании канала
client.on('channelCreate', async (channel) => {
  try {
    if (!channel.guild) return;
    const guild = channel.guild;
    const fetchedLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate });
    const log = fetchedLogs.entries.first();
    if (!log) return;
    const executor = log.executor;
    const action = "Создание каналов";

    const whitelistColl = getDb().collection('whitelist');
    let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });
    if (!whitelistDoc) {
      await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
      whitelistDoc = { whitelist: [] };
    }
    if (whitelistDoc.whitelist.includes(executor.id)) return;

    const member = guild.members.cache.get(executor.id) ||
                   await guild.members.fetch(executor.id).catch(() => null);
    if (!member) return;

    if (!(await antiCrashHandler(member, "create_channels_anti_crash", action))) return;

    // Удаляем созданный канал
    await channel.delete().catch(() => {});

    const rolesToRemove = member.roles.cache
      .filter(r => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => r);
    await Promise.all([
      removeRoles(member, rolesToRemove),
      checkBot(member),
      quarantine(member, rolesToRemove, action),
      dm(member, action)
    ]);
  } catch (err) {
    console.error('channelCreate error:', err);
  }
});

// При удалении роли
client.on('roleDelete', async (role) => {
  try {
      const guild = role.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete });
      const deletionLog = fetchedLogs.entries.first();
      if (!deletionLog) return;

      const { executor } = deletionLog;
      if (!executor || executor.id === client.user.id) return;

      const action = "Удаление роли";

      const whitelistColl = db.collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });

      if (!whitelistDoc) {
          await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
          whitelistDoc = { whitelist: [] };
      }

      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = guild.members.cache.get(executor.id) ||
                     await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      if (!(await antiCrashHandler(member, "role_anti_crash", action))) return;

      // Восстановление роли
      const newRole = await guild.roles.create({
          name: role.name,
          color: role.color,
          hoist: role.hoist,
          mentionable: role.mentionable,
          permissions: role.permissions.bitfield,
          position: role.position
      });

      // Восстановление разрешений для всех каналов
      guild.channels.cache.forEach(async (channel) => {
          const overwrites = channel.permissionOverwrites.cache.get(role.id);
          if (overwrites) {
              await channel.permissionOverwrites.create(newRole, {
                  allow: overwrites.allow.toArray(),
                  deny: overwrites.deny.toArray()
              });
          }
      });

      const rolesToRemove = member.roles.cache
          .filter(r => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map(r => r);

      await Promise.all([
          removeRoles(member, rolesToRemove),
          checkBot(member),
          quarantine(member, rolesToRemove, action),
          dm(member, action)
      ]);
  } catch (err) {
      console.error('Ошибка в roleDelete:', err);
  }
});

// При создании роли
client.on('roleCreate', async (role) => {
  try {
    const guild = role.guild;
    const fetchedLogs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate });
    const log = fetchedLogs.entries.first();
    if (!log) return;
    const executor = log.executor;
    const action = "Создание ролей";

    const whitelistColl = getDb().collection('whitelist');
    let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });
    if (!whitelistDoc) {
      await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
      whitelistDoc = { whitelist: [] };
    }
    if (whitelistDoc.whitelist.includes(executor.id)) return;

    // Удаляем созданную роль
    await role.delete().catch(() => {});

    const member = guild.members.cache.get(executor.id) ||
                   await guild.members.fetch(executor.id).catch(() => null);
    if (!member) return;

    if (!(await antiCrashHandler(member, "create_role_anti_crash", action))) return;

    const rolesToRemove = member.roles.cache
      .filter(r => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => r);
    await Promise.all([
      removeRoles(member, rolesToRemove),
      checkBot(member),
      quarantine(member, rolesToRemove, action),
      dm(member, action)
    ]);
  } catch (err) {
    console.error('roleCreate error:', err);
  }
});

// При обновлении вебхуков в канале
client.on('webhooksUpdate', async (channel) => {
  try {
    const webhooks = await channel.fetchWebhooks();
    if (webhooks.size > 0) {
      // Удаляем последний созданный вебхук
      const webhook = webhooks.last();
      if (webhook) await webhook.delete().catch(() => {});
    }
  } catch (err) {
    console.error('webhooksUpdate error:', err);
  }
});

// При обновлении роли (например, выдача прав администратора)
client.on('roleUpdate', async (oldRole, newRole) => {
  try {
    const guild = newRole.guild;
    const action = "Выдача админ прав на роль";
    if (!oldRole.permissions.has('ADMINISTRATOR') && newRole.permissions.has('ADMINISTRATOR')) {
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: 'ROLE_UPDATE' });
      const log = fetchedLogs.entries.first();
      if (!log) return;
      const executor = log.executor;

      const whitelistColl = getDb().collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });
      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }
      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = guild.members.cache.get(executor.id) ||
                     await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      if (!(await antiCrashHandler(member, "role_create_admin_anti_crash", action))) return;

      const rolesToRemove = member.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r);
      await Promise.all([
        removeRoles(member, rolesToRemove),
        checkBot(member),
        quarantine(member, rolesToRemove, action),
        dm(member, action)
      ]);
      // Пытаемся восстановить права роли
      try {
        await newRole.setPermissions(oldRole.permissions);
      } catch (err) {}
      try {
        await newRole.setPermissions(newRole.permissions);
      } catch (err) {}
    }
  } catch (err) {
    console.error('roleUpdate error:', err);
  }
});

client.on('guildMemberRemove', async (member) => {
  const auditLogs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
  const kickLog = auditLogs.entries.first();

  if (!kickLog) return;
  const { executor, target } = kickLog;

  if (target.id === member.id) {
      await punish(executor, member.guild, 'kicking members');
  }
});

// При входе нового участника (кикаем ботов, если check ≠ "OK")
client.on('guildMemberAdd', async (member) => {
  try {
    if (member.user.bot) {
      if (config.check === 'OK') return;
      await member.kick('Боты не разрешены');
    }
  } catch (err) {
    console.error('guildMemberAdd error:', err);
  }
});

// При изменении ролей участника (выдача/снятие ролей)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // Если изменились роли
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
      const guild = newMember.guild;
      const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: 'MEMBER_ROLE_UPDATE' });
      const log = fetchedLogs.entries.first();
      if (!log) return;
      const executor = log.executor;

      // Определяем, была ли выдана роль с правами администратора
      const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
      let permissionField, action;
      let adminRoleAdded = addedRoles.some(r => r.permissions.has('ADMINISTRATOR'));
      if (adminRoleAdded) {
        permissionField = "give_role_admin_anti_crash";
        action = "Выдача/снятие роли с админ правами";
      } else {
        permissionField = "give_role_anti_crash";
        action = "Выдача/снятие ролей";
      }

      const whitelistColl = getDb().collection('whitelist');
      let whitelistDoc = await whitelistColl.findOne({ _id: guild.id });
      if (!whitelistDoc) {
        await whitelistColl.insertOne({ _id: guild.id, whitelist: [] });
        whitelistDoc = { whitelist: [] };
      }
      if (whitelistDoc.whitelist.includes(executor.id)) return;

      const member = guild.members.cache.get(executor.id) ||
                     await guild.members.fetch(executor.id).catch(() => null);
      if (!member) return;

      if (!(await antiCrashHandler(member, permissionField, action))) return;

      if (member.roles.cache.some(r => r.permissions.has('ADMINISTRATOR'))) {
        const rolesToRemove = member.roles.cache
          .filter(r => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map(r => r);
        await Promise.all([
          removeRoles(member, rolesToRemove),
          checkBot(member),
          quarantine(member, rolesToRemove, action),
          dm(member, action)
        ]);
      }
    }
  } catch (err) {
    console.error('guildMemberUpdate error:', err);
  }
});

// ====== Периодическая задача для снижения счётчика "quarantine" ======
// Каждые 240 секунд проходим по документам коллекции anticrash и уменьшаем значение, если оно > 0
setInterval(async () => {
  try {
    const anticrashColl = getDb().collection('anticrash');
    const cursor = anticrashColl.find({});
    await cursor.forEach(async (doc) => {
      if (doc.quarantine > 0) {
        await anticrashColl.updateOne({ _id: doc._id }, { $inc: { quarantine: -1 } });
      }
    });
  } catch (err) {
    console.error('Периодическая задача anticrash error:', err);
  }
}, 240 * 1000);

// ====== Логиним бота ======
client.login(config.token);