const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    REST,
    Routes,
    SlashCommandBuilder,
    ComponentType
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
      .setName('anticrash_manage')
      .setDescription('Управление системой AntiCrash')
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
  
  // Обработчик команды /anticrash_manage
  client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
  
    if (interaction.commandName === 'anticrash_manage') {
      const menu = new UserSelectMenuBuilder()
        .setCustomId('select-user')
        .setPlaceholder('Выберите пользователя для управления');
  
      const row = new ActionRowBuilder().addComponents(menu);
  
      await interaction.reply({
        content: 'Выберите пользователя:',
        components: [row],
        ephemeral: true
      });
    }
  });
  
  // Обработчик выбора пользователя (selectmenu)
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
  
  // Обработчик модального окна (modal)
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
  
    // Кнопки подтверждения
    const confirmButton = new ButtonBuilder()
      .setCustomId('confirm-action')
      .setLabel('✅ Подтвердить')
      .setStyle(ButtonStyle.Success);
  
    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel-action')
      .setLabel('❌ Отмена')
      .setStyle(ButtonStyle.Danger);
  
    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
  
    await interaction.reply({
      content: ✅ Выбор сохранен!\n📌 **Причина**: ${reason}\n\n🔽 Подтвердите действие:,
      components: [row],
      ephemeral: true
    });
  });
  
  // Обработчик кнопок (buttonClick)
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
  
    const userData = await UserSelection.findOne({ userId: interaction.user.id });
  
    if (!userData) {
      return interaction.reply({ content: '❌ Ошибка: данные не найдены.', ephemeral: true });
    }
  
    if (interaction.customId === 'confirm-action') {
      await interaction.update({ content: ✅ Действие подтверждено!\n📌 **Цель:** <@${userData.selectedUserId}>\n📌 **Причина:** ${userData.reason}, components: [] });
    }
  
    if (interaction.customId === 'cancel-action') {
      await interaction.update({ content: '❌ Действие отменено.', components: [] });
    }
  });
  
  client.login(token);