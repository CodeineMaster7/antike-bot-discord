const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder
  } = require('discord.js');
  
  const mongoose = require('mongoose');
  const { clientId, guildId, token, mongodb } = require('../configs/antinuke.json');
  
  const mongoURI = mongodb;
  
  // Подключение к MongoDB
  mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }).then(() => console.log("✅ Успешное подключение к MongoDB"))
    .catch(err => console.error("❌ Ошибка подключения к MongoDB:", err));
  
// Модель для хранения групп и разрешений
const GroupSchema = new mongoose.Schema({
    guildId: String,
    groupId: String,
    permissions: {
      type: Map,
      of: String // "allow", "deny", "limit"
    }
  });
  const Group = mongoose.model("Group", GroupSchema);

  // Модель для хранения данных
  const userSelectionSchema = new mongoose.Schema({
    userId: String,
    selectedUserId: String,
    reason: String
  });
  const UserSelection = mongoose.model("UserSelection", userSelectionSchema);
  
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  
  const commands = [
    new SlashCommandBuilder()
      .setName('anticrash')
      .setDescription('Команды управления системой AntiCrash')
      .addSubcommand(subcommand =>
        subcommand
          .setName('manage')
          .setDescription('Управление белым списком и защитой'))
  ].map(command => command.toJSON());
  
  const rest = new REST({ version: '10' }).setToken(token);
  
  // Регистрация команд
  (async () => {
    try {
      console.log('🚀 Обновление (/) команд...');
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log('✅ Успешно обновлены (/) команды.');
    } catch (error) {
      console.error(error);
    }
  })();
  
  client.once('ready', () => {
    console.log('🤖 Бот готов!');
  });
  
  // Обработчик команды /anticrash manage
  client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName !== 'anticrash' || interaction.options.getSubcommand() !== 'manage') return;
  
    ownerId = interaction.guild.owner

    const embedP = new EmbedBuilder()
    .setColor(3092790)
    .setDescription(`${interaction.user}, У **Вас** недостаточно прав на **выполнение этой команды**`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setAuthor({ name: `🔧 Недостаточно прав | ${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
    
    if (interaction.user.id !== ownerId && (!Array.isArray(mainWhitelist) || !mainWhitelist.includes(interaction.user.id))) {
        return interaction.reply({ embeds: [embedP], ephemeral: true });
      }

    // Выпадающие списки
    const userMenu = new UserSelectMenuBuilder()
      .setCustomId('select-user')
      .setPlaceholder('Выберите пользователя');
  
    const roleMenu = new RoleSelectMenuBuilder()
      .setCustomId('select-role')
      .setPlaceholder('Выберите роль');
  
    const channelMenu = new ChannelSelectMenuBuilder()
      .setCustomId('select-channel')
      .setPlaceholder('Выберите канал');
  
    const userRow = new ActionRowBuilder().addComponents(userMenu);
    const roleRow = new ActionRowBuilder().addComponents(roleMenu);
    const channelRow = new ActionRowBuilder().addComponents(channelMenu);
  
    // Кнопки
    const whitelistButton = new ButtonBuilder()
      .setCustomId('add-whitelist')
      .setLabel('➕ Добавить в белый список')
      .setStyle(ButtonStyle.Success);
  
    const viewWhitelistButton = new ButtonBuilder()
      .setCustomId('view-whitelist')
      .setLabel('📃 Список белого списка')
      .setStyle(ButtonStyle.Primary);
  
    const exitButton = new ButtonBuilder()
      .setCustomId('exit')
      .setLabel('🚪 Выход')
      .setStyle(ButtonStyle.Danger);
  
    const buttonRow = new ActionRowBuilder().addComponents(whitelistButton, viewWhitelistButton, exitButton);
      
    const groupRoles = {
        "Администратор": "112233445566778899", // ID роли администратора
        "Модератор": "998877665544332211", // ID роли модератора
        "Участник": "223344556677889900" // ID обычного участника
      };

    let userGroup = "Неизвестно";
    for (const [groupName, roleId] of Object.entries(groupRoles)) {
      if (interaction.user.roles.cache.has(roleId)) {
        userGroup = groupName;
        break;
      }
    }

    const embed = new EmbedBuilder()
    .setColor(3092790)
    .setDescription(`${interaction.user}, **Выберите** группы, с которыми вы желаете **взаимодействовать**`)
    .addFields([
      { name: "> Пользователь:", value: `・${interaction.user} \n・${interaction.user.tag}\n・**${interaction.user.id}**` },
      { name: "> Группа пользователя:", value: `\`\`\`${userGroup}\`\`\`` } // Добавлено поле с группой
    ])
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setAuthor({ name: `🔧 Меню управления AntiCrash | ${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) });

    await interaction.reply({
      embeds: [embed],
      components: [userRow, roleRow, channelRow, buttonRow],
      ephemeral: true
    });
  });
  
  // Обработчик выбора пользователя
  client.on('interactionCreate', async interaction => {
    if (!interaction.isUserSelectMenu()) return;
    if (interaction.customId !== 'select-user') return;
  
    const selectedUserId = interaction.values[0];
  
    // Сохраняем в MongoDB
    await UserSelection.findOneAndUpdate(
      { userId: interaction.user.id },
      { selectedUserId },
      { upsert: true, new: true }
    );
  
    // Отправляем модальное окно
    const modal = new ModalBuilder()
      .setCustomId('user-reason-modal')
      .setTitle('Причина выбора');
  
    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Почему вы выбрали этого пользователя?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
  
    const row = new ActionRowBuilder().addComponents(reasonInput);
    modal.addComponents(row);
  
    await interaction.showModal(modal);
  });
  
  // Обработчик модального окна
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'user-reason-modal') return;
  
    const reason = interaction.fields.getTextInputValue('reason');
  
    // Обновляем запись в MongoDB
    await UserSelection.findOneAndUpdate(
      { userId: interaction.user.id },
      { reason },
      { upsert: true, new: true }
    );
  
    await interaction.reply({ content: `✅ Выбор сохранен!\n📌 **Причина**: ${reason}`, ephemeral: true });
  });
  
  // Обработчик нажатия кнопок
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
  
    if (interaction.customId === 'add-whitelist') {
      await interaction.reply({ content: '✅ Пользователь/Роль/Канал добавлен в белый список!', ephemeral: true });
    }
  
    if (interaction.customId === 'view-whitelist') {
      await interaction.reply({ content: '📃 **Список белого списка:**\n(здесь будет список)', ephemeral: true });
    }
  
    if (interaction.customId === 'exit') {
      await interaction.message.delete().catch(() => {});
    }
  });
  
  // Обработчик выбора ролей
  client.on('interactionCreate', async interaction => {
    if (!interaction.isRoleSelectMenu()) return;
    if (interaction.customId !== 'select-role') return;
  
    const selectedRoleId = interaction.values[0];
  
    await interaction.reply({ content: `✅ Роль <@&${selectedRoleId}> выбрана.`, ephemeral: true });
  });
  
  // Обработчик выбора каналов
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChannelSelectMenu()) return;
    if (interaction.customId !== 'select-channel') return;
  
    const selectedChannelId = interaction.values[0];
  
    await interaction.reply({ content: `✅ Канал <#${selectedChannelId}> выбран.`, ephemeral: true });
  });
  
  client.login(token);
  