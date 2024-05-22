const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { getProfile } = require('./middleware/getProfile')
const Sequelize = require('sequelize');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const { id } = req.params;
    const profileId = req.profile.id;

    const contract = await Contract.findOne({ where: { id } });

    if (!contract) {
        return res.status(404).end();
    }

    // Check if the profile is either the client or the contractor of the contract
    if (contract.ClientId !== profileId && contract.ContractorId !== profileId) {
        return res.status(403).json({ message: 'Access denied' });
    }

    res.json(contract);
});

app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const profileId = req.profile.id;
    const profileType = req.profile.type;

    const contracts = await Contract.findAll({
        where: {
            [Sequelize.Op.or]: [
                { ClientId: profileId },
                { ContractorId: profileId }
            ],
            status: {
                [Sequelize.Op.ne]: 'terminated'
            }
        }
    });

    res.json(contracts);
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Contract, Job } = req.app.get('models');
    const profileId = req.profile.id;

    const contracts = await Contract.findAll({
        where: {
            [Sequelize.Op.or]: [
                { ClientId: profileId },
                { ContractorId: profileId }
            ],
            status: 'in_progress'
        }
    });

    const contractIds = contracts.map(contract => contract.id);

    const unpaidJobs = await Job.findAll({
        where: {
            ContractId: {
                [Sequelize.Op.in]: contractIds
            },
            paid: false
        }
    });

    res.json(unpaidJobs);
});

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { job_id } = req.params;
    const { amount } = req.body;
    const profileId = req.profile.id;

    const job = await Job.findOne({
        where: { id: job_id },
        include: {
            model: Contract,
            where: { status: 'in_progress' },
            include: [
                { model: Profile, as: 'Client' },
                { model: Profile, as: 'Contractor' }
            ]
        }
    });

    if (!job) {
        return res.status(404).json({ message: 'Job not found' });
    }

    const contract = job.Contract;
    const client = contract.Client;
    const contractor = contract.Contractor;

    if (client.id !== profileId) {
        return res.status(403).json({ message: 'Access denied' });
    }

    if (client.balance < amount) {
        return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Transaction to ensure atomicity
    const t = await sequelize.transaction();
    try {
        // Deduct job price from client's balance
        await Profile.update(
            { balance: client.balance - amount }, // Usar el monto enviado
            { where: { id: client.id }, transaction: t }
        );

        // Add job price to contractor's balance
        await Profile.update(
            { balance: contractor.balance + amount }, // Usar el monto enviado
            { where: { id: contractor.id }, transaction: t }
        );

        // Mark job as paid
        await Job.update(
            { paid: true, paymentDate: new Date() },
            { where: { id: job.id }, transaction: t }
        );

        await t.commit();
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Payment failed', error: error.message });
    }

    res.json({ message: 'Payment successful' });
});


app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    const { Profile, Job, Contract, sequelize } = req.app.get('models');
    const { userId } = req.params;
    const depositAmount = req.body.amount;

    // Ensure the profile is the client depositing the amount
    if (req.profile.id != userId || req.profile.type !== 'client') {
        return res.status(403).json({ message: 'Access denied' });
    }

    // Get all active contracts where the profile is the client
    const contracts = await Contract.findAll({
        where: {
            ClientId: userId,
            status: 'in_progress'
        },
        include: [
            {
                model: Job,
                required: true, // This ensures only contracts with unpaid jobs are included
                where: { paid: false }
            }
        ]
    });

    // Calculate the total of jobs to pay
    const totalJobsToPay = contracts.reduce((total, contract) => {
        return total + contract.Jobs.reduce((sum, job) => sum + job.price, 0);
    }, 0);

    // Calculate the maximum deposit allowed (25% of total jobs to pay)
    const maxDeposit = totalJobsToPay * 0.25;

    // Ensure the deposit amount does not exceed the maximum allowed
    if (depositAmount > maxDeposit) {
        return res.status(400).json({ message: `Deposit amount exceeds the maximum allowed of ${maxDeposit}` });
    }

    // Transaction to ensure atomicity
    const t = await sequelize.transaction();
    try {
        // Update client's balance
        await Profile.update(
            { balance: req.profile.balance + depositAmount },
            { where: { id: userId }, transaction: t }
        );

        await t.commit();
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Deposit failed', error: error.message });
    }

    res.json({ message: 'Deposit successful' });
});


app.get('/admin/best-profession', async (req, res) => {
    const { Job, Profile, Contract } = req.app.get('models');
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).json({ message: 'Start and end dates are required' });
    }

    const bestProfession = await Profile.findAll({
        attributes: [
            'profession',
            [sequelize.fn('SUM', sequelize.col('price')), 'total_earned']
        ],
        include: [{
            model: Contract,
            as: 'Contractor',
            include: [{
                model: Job,
                where: {
                    paid: true,
                    paymentDate: {
                        [Sequelize.Op.between]: [new Date(start), new Date(end)]
                    }
                }
            }]
        }],
        group: ['profession'],
        order: [[sequelize.literal('total_earned'), 'DESC']],
        limit: 1
    });

    if (bestProfession.length === 0) {
        return res.status(404).json({ message: 'No profession found in the given date range' });
    }

    res.json(bestProfession[0]);
});

app.get('/admin/best-clients', async (req, res) => {
    const { Job, Profile, Contract } = req.app.get('models');
    const { start, end, limit = 2 } = req.query;

    if (!start || !end) {
        return res.status(400).json({ message: 'Start and end dates are required' });
    }

    const bestClients = await Profile.findAll({
        attributes: [
            'id',
            [sequelize.literal("firstName || ' ' || lastName"), 'fullName'],
            [sequelize.fn('SUM', sequelize.col('price')), 'paid']
        ],
        include: [{
            model: Contract,
            as: 'Client',
            include: [{
                model: Job,
                where: {
                    paid: true,
                    paymentDate: {
                        [Sequelize.Op.between]: [new Date(start), new Date(end)]
                    }
                }
            }]
        }],
        group: ['Profile.id'],
        order: [[sequelize.literal('paid'), 'DESC']],
        limit: parseInt(limit)
    });

    if (bestClients.length === 0) {
        return res.status(404).json({ message: 'No clients found in the given date range' });
    }

    res.json(bestClients);
});



module.exports = app;
