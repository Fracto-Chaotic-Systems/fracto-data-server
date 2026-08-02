import {db_connect, db_disconnect, insert, select} from "../mysql.js";

export const handle_lore_categories = (req, res) => {
    const query = {
        table: 'lore_category',
        order: 'id desc',
    }
    console.log('handle_lore_categories', query)
    try {
        const connection = db_connect()
        select(connection, query, (result) => {
            console.log('lore_category yay 200');
            res.status(200).json({result});
            db_disconnect(connection);
        })
    } catch (error) {
        console.log(error);
        res.status(500).json({error});
    }
}

export const handle_lore_content = (req, res) => {
    const {id} = req.query
    const query = {
        table: 'lore_content',
        order: 'id desc',
    }
    if (id) {
        query.where = `id=${id}`
    }
    console.log('handle_lore_content', query)
    try {
        const connection = db_connect()
        select(connection, query, (result) => {
            console.log('lore_content yay 200');
            res.status(200).json({result});
            db_disconnect(connection);
        })
    } catch (error) {
        console.log(error);
        res.status(500).json({error});
    }
}

export const handle_lore_storage = (req, res) => {
    // console.log(JSON.stringify(req.body))
    const {
        title,
        category,
        content_data,
        content_meta,
        category_key,
    } = req.body;
    try {
        const connection = db_connect()
        insert(connection,
            'lore_content',
            {
                title,
                category,
                content_data: JSON.stringify(content_data),
                content_meta: JSON.stringify(content_meta),
                category_key,
            },
            result => {
                // console.log('insert tile', short_code)
                res.status(200).json({result});
                db_disconnect(connection);
            }
        )
    } catch (error) {
        console.log(error);
        res.status(500).json({error});
    }
}

export const handle_lore_content_list = (req, res) => {
    const {category_id} = req.query
    const query = {
        table: 'lore_content',
        order: 'title asc',
        where: `category=${category_id}`,
    }
    console.log('handle_lore_content_list', query)
    try {
        const connection = db_connect()
        select(connection, query, (result) => {
            console.log(`lore_content yay 200 ${result.length} results`);
            res.status(200).json({result});
            db_disconnect(connection);
        })
    } catch (error) {
        console.log(error);
        res.status(500).json({error});
    }
}
